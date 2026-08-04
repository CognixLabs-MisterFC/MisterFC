import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyDrainResult,
  buildMatchEventRow,
  countFailed,
  countPending,
  enqueueEvent,
  failedEntries,
  hasUnconfirmed,
  overlayRows,
  pendingForDrain,
  pruneConfirmed,
  resetFailedToPending,
  upsertMatchEventFromClient,
  EMPTY_QUEUE,
  MAX_DRAIN_ATTEMPTS,
  type EventQueue,
  type QueuedMatchEventRow,
} from '../event-queue';
import type { ClockPeriod } from '../clock';
import type { Database } from '../../supabase/types';

const EVENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLUB = 'cccccccc-0000-4000-8000-000000000001';
const USER = 'uuuuuuuu-0000-4000-8000-000000000001';
const P1 = 'pppppppp-0000-4000-8000-000000000001';
const P2 = 'pppppppp-0000-4000-8000-000000000002';

// Reloj: 1ª parte corriendo desde un instante fijo; el evento cae a los 65s.
const STARTED = '2020-01-01T00:00:00.000Z';
const NOW = Date.parse(STARTED) + 65_000;
const PERIODS: ClockPeriod[] = [
  {
    period: 'first_half',
    ordinal: 1,
    baseOffsetSeconds: 0,
    accumulatedSeconds: 0,
    running: true,
    lastStartedAt: STARTED,
    ended: false,
  },
];

function ctx(id: string) {
  return { id, eventId: EVENT, clubId: CLUB, createdBy: USER, periods: PERIODS, nowMs: NOW };
}

const uid = (n: number) => `eeeeeeee-0000-4000-8000-00000000000${n}`;

// ─────────────────────────────────────────────────────────────────────────────
// Mock del cliente: registra los upserts por id respetando ignoreDuplicates, e
// inyecta fallo (error DEVUELTO = permanente) o excepción (LANZADA = transitorio).
// ─────────────────────────────────────────────────────────────────────────────
type UpsertMock = {
  client: SupabaseClient<Database>;
  rows: Map<string, QueuedMatchEventRow>;
  calls: number;
};

function makeClient(inject?: { returnCode?: string; returnMessage?: string; throwErr?: boolean }): UpsertMock {
  const rows = new Map<string, QueuedMatchEventRow>();
  let calls = 0;
  const client = {
    from(table: string) {
      expect(table).toBe('match_events');
      return {
        upsert(row: QueuedMatchEventRow, opts: { onConflict: string; ignoreDuplicates: boolean }) {
          calls += 1;
          // Contrato que la idempotencia EXIGE.
          expect(opts.onConflict).toBe('id');
          expect(opts.ignoreDuplicates).toBe(true);
          if (inject?.throwErr) {
            return Promise.reject(new Error('network down'));
          }
          if (inject?.returnCode || inject?.returnMessage) {
            return Promise.resolve({
              error: { code: inject.returnCode, message: inject.returnMessage ?? 'err' },
            });
          }
          // ignoreDuplicates: el primer id gana; repetir el mismo id es no-op.
          if (!rows.has(row.id)) rows.set(row.id, row);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, get rows() { return rows; }, get calls() { return calls; } };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('buildMatchEventRow (fila completa en el instante del toque)', () => {
  it('gol propio: side own, type goal, player_id, reloj derivado (65s)', () => {
    const row = buildMatchEventRow({ kind: 'player_goal', playerId: P1 }, ctx(uid(1)));
    expect(row).toMatchObject({
      id: uid(1),
      event_id: EVENT,
      club_id: CLUB,
      created_by: USER,
      side: 'own',
      type: 'goal',
      player_id: P1,
      related_player_id: null,
      rival_dorsal: null,
      period: 'first_half',
      clock_seconds: 65,
    });
  });

  it('tarjeta: type según la tarjeta elegida', () => {
    const y = buildMatchEventRow({ kind: 'card', card: 'yellow_card', playerId: P1 }, ctx(uid(2)));
    expect(y).toMatchObject({ side: 'own', type: 'yellow_card', player_id: P1 });
    const r = buildMatchEventRow({ kind: 'card', card: 'red_card', playerId: P1 }, ctx(uid(3)));
    expect(r.type).toBe('red_card');
  });

  it('cambio: player_id=SALE, related_player_id=ENTRA', () => {
    const row = buildMatchEventRow(
      { kind: 'substitution', playerOutId: P1, playerInId: P2 },
      ctx(uid(4)),
    );
    expect(row).toMatchObject({
      side: 'own',
      type: 'substitution',
      player_id: P1,
      related_player_id: P2,
    });
  });

  it('gol rival: side rival, dorsal, sin jugador', () => {
    const row = buildMatchEventRow({ kind: 'rival_goal', dorsal: 9 }, ctx(uid(5)));
    expect(row).toMatchObject({ side: 'rival', type: 'goal', rival_dorsal: 9, player_id: null });
  });

  it('mismo ctx (mismo id/nowMs) → misma fila (pura, reproducible)', () => {
    const a = buildMatchEventRow({ kind: 'player_goal', playerId: P1 }, ctx(uid(1)));
    const b = buildMatchEventRow({ kind: 'player_goal', playerId: P1 }, ctx(uid(1)));
    expect(a).toEqual(b);
  });
});

describe('cola: transiciones puras', () => {
  const row1 = buildMatchEventRow({ kind: 'player_goal', playerId: P1 }, ctx(uid(1)));
  const row2 = buildMatchEventRow({ kind: 'card', card: 'yellow_card', playerId: P2 }, ctx(uid(2)));

  it('enqueue añade pending; re-enqueue del mismo id NO duplica (idempotente)', () => {
    let q: EventQueue = EMPTY_QUEUE;
    q = enqueueEvent(q, row1);
    q = enqueueEvent(q, row1); // doble toque / re-carga
    expect(q).toHaveLength(1);
    expect(q[0]!.status).toBe('pending');
    expect(countPending(q)).toBe(1);
  });

  it('ok → uploaded (NO se borra hasta confirmar en servidor)', () => {
    let q = enqueueEvent(EMPTY_QUEUE, row1);
    q = applyDrainResult(q, row1.id, { kind: 'ok' });
    expect(q).toHaveLength(1);
    expect(q[0]!.status).toBe('uploaded');
    expect(hasUnconfirmed(q)).toBe(true);
    expect(overlayRows(q)).toHaveLength(1); // uploaded sí superpone
  });

  it('permanent → failed con motivo; NO cuenta en overlay (marcador)', () => {
    let q = enqueueEvent(EMPTY_QUEUE, row1);
    q = applyDrainResult(q, row1.id, { kind: 'permanent', error: 'forbidden' });
    expect(q[0]!.status).toBe('failed');
    expect(q[0]!.failure).toBe('forbidden');
    expect(countFailed(q)).toBe(1);
    expect(overlayRows(q)).toHaveLength(0);
    expect(failedEntries(q)).toHaveLength(1);
  });

  it('transient → sigue pending; al superar el tope → failed', () => {
    let q = enqueueEvent(EMPTY_QUEUE, row1);
    for (let i = 0; i < MAX_DRAIN_ATTEMPTS - 1; i++) {
      q = applyDrainResult(q, row1.id, { kind: 'transient' });
      expect(q[0]!.status).toBe('pending');
    }
    q = applyDrainResult(q, row1.id, { kind: 'transient' }); // intento nº MAX
    expect(q[0]!.status).toBe('failed');
    expect(q[0]!.failure).toBe('generic');
  });

  it('prune quita SOLO los uploaded confirmados en servidor; pending/failed quedan', () => {
    let q = enqueueEvent(EMPTY_QUEUE, row1);
    q = enqueueEvent(q, row2);
    q = applyDrainResult(q, row1.id, { kind: 'ok' }); // row1 uploaded
    // row2 sigue pending; el servidor confirma row1.
    q = pruneConfirmed(q, new Set([row1.id]));
    expect(q).toHaveLength(1);
    expect(q[0]!.row.id).toBe(row2.id);
    expect(q[0]!.status).toBe('pending');
  });

  it('prune NO borra un failed aunque aparezca por id (se conserva el aviso)', () => {
    let q = enqueueEvent(EMPTY_QUEUE, row1);
    q = applyDrainResult(q, row1.id, { kind: 'permanent', error: 'forbidden' });
    q = pruneConfirmed(q, new Set([row1.id]));
    expect(q).toHaveLength(1);
    expect(q[0]!.status).toBe('failed');
  });

  it('resetFailedToPending reencola los fallidos para reintento manual', () => {
    let q = enqueueEvent(EMPTY_QUEUE, row1);
    q = applyDrainResult(q, row1.id, { kind: 'permanent', error: 'forbidden' });
    q = resetFailedToPending(q);
    expect(q[0]!.status).toBe('pending');
    expect(q[0]!.attempts).toBe(0);
    expect(q[0]!.failure).toBeUndefined();
  });
});

describe('upsertMatchEventFromClient (primitivo de subida idempotente)', () => {
  const row = buildMatchEventRow({ kind: 'player_goal', playerId: P1 }, ctx(uid(1)));

  it('subida ok', async () => {
    const m = makeClient();
    const r = await upsertMatchEventFromClient(m.client, row);
    expect(r.ok).toBe(true);
    expect(m.rows.get(row.id)).toEqual(row);
  });

  it('subir DOS veces el mismo id = un solo evento (onConflict id, ignoreDuplicates)', async () => {
    const m = makeClient();
    await upsertMatchEventFromClient(m.client, row);
    await upsertMatchEventFromClient(m.client, row); // reintento tras "no sé si subió"
    expect(m.calls).toBe(2);
    expect(m.rows.size).toBe(1); // el 2º es no-op
  });

  it('error de Postgres 42501 → permanente/forbidden (RLS rechaza)', async () => {
    const m = makeClient({ returnCode: '42501' });
    const r = await upsertMatchEventFromClient(m.client, row);
    expect(r).toEqual({ ok: false, permanent: true, error: 'forbidden' });
  });

  it('CHECK de jugador → permanente/player_not_in_team', async () => {
    const m = makeClient({ returnMessage: 'player_not_in_team_at_event' });
    const r = await upsertMatchEventFromClient(m.client, row);
    expect(r).toMatchObject({ ok: false, permanent: true, error: 'player_not_in_team' });
  });

  it('excepción de red (LANZADA) → transitorio (reintentable)', async () => {
    const m = makeClient({ throwErr: true });
    const r = await upsertMatchEventFromClient(m.client, row);
    expect(r).toEqual({ ok: false, permanent: false, error: 'generic' });
  });
});

describe('drenado en orden con AISLAMIENTO (un fallo no bloquea a los demás)', () => {
  it('A rechazada (permanente) → failed; B y C se suben igual', async () => {
    const rowA = buildMatchEventRow({ kind: 'player_goal', playerId: P1 }, ctx(uid(1)));
    const rowB = buildMatchEventRow({ kind: 'card', card: 'yellow_card', playerId: P2 }, ctx(uid(2)));
    const rowC = buildMatchEventRow({ kind: 'rival_goal', dorsal: 7 }, ctx(uid(3)));
    let q = enqueueEvent(EMPTY_QUEUE, rowA);
    q = enqueueEvent(q, rowB);
    q = enqueueEvent(q, rowC);

    // A va contra un cliente que la rechaza (RLS); B y C contra uno que acepta.
    const reject = makeClient({ returnCode: '42501' });
    const accept = makeClient();

    for (const entry of pendingForDrain(q)) {
      const target = entry.row.id === rowA.id ? reject : accept;
      const out = await upsertMatchEventFromClient(target.client, entry.row);
      q = applyDrainResult(
        q,
        entry.row.id,
        out.ok
          ? { kind: 'ok' }
          : out.permanent
            ? { kind: 'permanent', error: out.error }
            : { kind: 'transient' },
      );
    }

    expect(q.find((e) => e.row.id === rowA.id)!.status).toBe('failed');
    expect(q.find((e) => e.row.id === rowB.id)!.status).toBe('uploaded');
    expect(q.find((e) => e.row.id === rowC.id)!.status).toBe('uploaded');
    expect(accept.rows.size).toBe(2); // B y C subidas pese al fallo de A
  });
});
