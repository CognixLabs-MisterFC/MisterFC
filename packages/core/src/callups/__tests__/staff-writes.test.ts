import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearCallupDecisionFromClient,
  upsertCallupDecisionFromClient,
} from '../staff-writes';
import { eventScopedCacheKey } from '../../offline/read-cache';
import type { Database } from '../../supabase/types';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_ID = '22222222-2222-4222-8222-222222222222';
const PLAYER_ID_2 = '33333333-3333-4333-8333-333333333333';

/**
 * Mock de SupabaseClient para las decisiones de convocatoria. Cuenta update/insert/
 * delete sobre `callup_decisions` y programa la fila existente para ejercitar las dos
 * ramas del upsert incremental (UPDATE vs INSERT). El sync de alineación consulta
 * `lineups` (select→eq): se resuelve a `[]` por defecto (no-op best-effort), salvo que
 * `lineupsThrow` fuerce un fallo para comprobar que NO rompe la decisión.
 */
type WriteCalls = {
  updates: Array<{ patch: unknown; ids: unknown[] }>;
  inserts: unknown[];
  deletes: number;
};

function makeClient(opts: {
  existing?: { event_id: string } | null;
  updateError?: { code?: string; message?: string } | null;
  insertError?: { code?: string; message?: string } | null;
  deleteError?: { code?: string; message?: string } | null;
  user?: { id: string } | null;
  lineupsThrow?: boolean;
}): { client: SupabaseClient<Database>; calls: WriteCalls } {
  const calls: WriteCalls = { updates: [], inserts: [], deletes: 0 };
  const hasUser = opts.user !== undefined ? opts.user : { id: 'coach-1' };

  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) {
      builder[m] = () => builder;
    }
    // Thenable: `await from('lineups').select('id').eq(...)` resuelve a []. Un
    // fallo programado simula el error que el best-effort debe tragar.
    builder.then = (
      resolve: (v: { data: unknown[]; error: null }) => unknown,
      reject: (e: unknown) => unknown,
    ) => {
      if (table === 'lineups' && opts.lineupsThrow) return reject(new Error('boom'));
      return resolve({ data: [], error: null });
    };
    builder.maybeSingle = async () => ({ data: opts.existing ?? null });
    builder.update = (patch: unknown) => ({
      eq: (_c1: string, id1: unknown) => ({
        eq: (_c2: string, id2: unknown) => {
          calls.updates.push({ patch, ids: [id1, id2] });
          return Promise.resolve({ error: opts.updateError ?? null });
        },
      }),
    });
    builder.insert = (row: unknown) => {
      calls.inserts.push(row);
      return Promise.resolve({ error: opts.insertError ?? null });
    };
    builder.delete = () => ({
      eq: (_c1: string, _id1: unknown) => ({
        eq: (_c2: string, _id2: unknown) => {
          calls.deletes += 1;
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      }),
    });
    return builder;
  };

  const client = {
    from,
    auth: { getUser: async () => ({ data: { user: hasUser } }) },
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

describe('O2-7b-1 · upsertCallupDecisionFromClient (incremental)', () => {
  it('sin fila existente → UN INSERT con decided_by = user, cero UPDATE', async () => {
    const { client, calls } = makeClient({ existing: null });
    const res = await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      decision: 'discarded',
      reason: null,
    });
    expect(res).toEqual({ ok: true });
    expect(calls.inserts).toHaveLength(1);
    expect(calls.updates).toHaveLength(0);
    expect((calls.inserts[0] as { decided_by: string }).decided_by).toBe('coach-1');
    expect((calls.inserts[0] as { decision: string }).decision).toBe('discarded');
  });

  it('con fila existente → UN UPDATE de decision/reason, cero INSERT', async () => {
    const { client, calls } = makeClient({ existing: { event_id: EVENT_ID } });
    const res = await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      decision: 'called_up',
      reason: null,
    });
    expect(res).toEqual({ ok: true });
    expect(calls.updates).toHaveLength(1);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates[0]!.patch).toMatchObject({ decision: 'called_up' });
    expect(calls.updates[0]!.ids).toEqual([EVENT_ID, PLAYER_ID]);
  });

  it('cada decisión persiste sola: dos jugadores → dos escrituras (no batch)', async () => {
    const { client, calls } = makeClient({ existing: null });
    await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      decision: 'discarded',
      reason: null,
    });
    await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID_2,
      decision: 'discarded',
      reason: null,
    });
    expect(calls.inserts).toHaveLength(2);
  });

  it('GATE server-side: INSERT rechazado por RLS (42501) → forbidden, sin crash', async () => {
    const { client } = makeClient({ existing: null, insertError: { code: '42501' } });
    const res = await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      decision: 'discarded',
      reason: null,
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('GATE server-side: UPDATE rechazado por RLS (42501) → forbidden', async () => {
    const { client } = makeClient({
      existing: { event_id: EVENT_ID },
      updateError: { code: '42501' },
    });
    const res = await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      decision: 'discarded',
      reason: null,
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('error de trigger (player_not_in_team_at_event) → se mapea el código', async () => {
    const { client } = makeClient({
      existing: null,
      insertError: { message: 'player_not_in_team_at_event' },
    });
    const res = await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      decision: 'discarded',
      reason: null,
    });
    expect(res).toEqual({ ok: false, error: 'player_not_in_team_at_event' });
  });

  it('sin sesión (user null) → forbidden (sin tocar la BD)', async () => {
    const { client, calls } = makeClient({ existing: null, user: null });
    const res = await upsertCallupDecisionFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      decision: 'discarded',
      reason: null,
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(calls.inserts).toHaveLength(0);
  });

  it('event_id no-UUID → validación event_invalid (sin tocar la BD)', async () => {
    const { client, calls } = makeClient({ existing: null });
    const res = await upsertCallupDecisionFromClient(client, {
      event_id: 'not-a-uuid',
      player_id: PLAYER_ID,
      decision: 'discarded',
      reason: null,
    });
    expect(res).toEqual({ ok: false, error: 'event_invalid' });
    expect(calls.inserts).toHaveLength(0);
  });

  it('un fallo del sync de alineación NO rompe la decisión (best-effort) y lo reporta', async () => {
    const { client } = makeClient({ existing: null, lineupsThrow: true });
    const onSyncError = vi.fn();
    const res = await upsertCallupDecisionFromClient(
      client,
      {
        event_id: EVENT_ID,
        player_id: PLAYER_ID,
        decision: 'discarded',
        reason: null,
      },
      onSyncError,
    );
    expect(res).toEqual({ ok: true });
    expect(onSyncError).toHaveBeenCalledTimes(1);
  });
});

describe('O2-7b-1 · clearCallupDecisionFromClient', () => {
  it('borra la fila → ok', async () => {
    const { client, calls } = makeClient({});
    const res = await clearCallupDecisionFromClient(client, EVENT_ID, PLAYER_ID);
    expect(res).toEqual({ ok: true });
    expect(calls.deletes).toBe(1);
  });

  it('DELETE 42501 → forbidden', async () => {
    const { client } = makeClient({ deleteError: { code: '42501' } });
    const res = await clearCallupDecisionFromClient(client, EVENT_ID, PLAYER_ID);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('O2-7b-1 · cache key event-scoped lleva el eventId', () => {
  it('eventScopedCacheKey incluye el id del evento', () => {
    const key = eventScopedCacheKey('convocatoria-staff', EVENT_ID);
    expect(key).toBe(`convocatoria-staff.${EVENT_ID}`);
    expect(key).toContain(EVENT_ID);
  });
});
