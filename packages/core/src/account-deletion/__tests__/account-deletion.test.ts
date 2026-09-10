import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  previewAccountDeletionFromClient,
  getMyAccountDeletionStatusFromClient,
} from '../reads';
import {
  requestAccountDeletionFromClient,
  cancelAccountDeletionFromClient,
} from '../actions';

/** Mock de `.rpc(...)`: devuelve siempre la misma respuesta. */
function makeClient(resp: { data?: unknown; error?: unknown }) {
  return { rpc: () => Promise.resolve(resp) } as unknown as SupabaseClient<Database>;
}

/** Mock que además captura (nombre, args) de la llamada. */
function makeSpyClient(resp: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(resp));
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe('previewAccountDeletionFromClient', () => {
  it('mapea las filas y formatea el nombre con "apellido, nombre"', async () => {
    const sb = makeClient({
      data: [
        {
          player_id: 'p1',
          first_name: 'Uno',
          last_name: 'Solo',
          club_id: 'c1',
          club_name: 'Club A',
        },
      ],
      error: null,
    });
    const r = await previewAccountDeletionFromClient(sb);
    expect(r).toEqual({
      ok: true,
      blockers: [{ playerId: 'p1', playerName: 'Solo, Uno', clubId: 'c1', clubName: 'Club A' }],
    });
  });

  it('last_name null → solo el nombre de pila (jugador ya suprimido por F14-7)', async () => {
    const sb = makeClient({
      data: [
        { player_id: 'p1', first_name: 'Uno', last_name: null, club_id: 'c1', club_name: 'Club A' },
      ],
      error: null,
    });
    const r = await previewAccountDeletionFromClient(sb);
    expect(r.ok && r.blockers[0]?.playerName).toBe('Uno');
  });

  it('sin bloqueantes → ok con lista vacía (camino rápido)', async () => {
    const r = await previewAccountDeletionFromClient(makeClient({ data: [], error: null }));
    expect(r).toEqual({ ok: true, blockers: [] });
  });

  it('ERROR de lectura → ok:false, NUNCA una lista vacía', async () => {
    // Si esto devolviera [], el usuario leería "no se pedirá la supresión de nadie" y
    // confirmaría un borrado cuyo alcance real es otro.
    const err = { message: 'boom' };
    const r = await previewAccountDeletionFromClient(makeClient({ data: null, error: err }));
    expect(r).toEqual({ ok: false, raw: err });
  });

  it('data null sin error → lista vacía, no revienta', async () => {
    const r = await previewAccountDeletionFromClient(makeClient({ data: null, error: null }));
    expect(r).toEqual({ ok: true, blockers: [] });
  });
});

describe('getMyAccountDeletionStatusFromClient', () => {
  it('con borrado en curso → estado mapeado', async () => {
    const sb = makeClient({
      data: [
        {
          request_id: 'r1',
          requested_at: '2026-09-10T10:00:00Z',
          deadline_at: '2026-10-10T10:00:00Z',
          pending_players: 2,
        },
      ],
      error: null,
    });
    const r = await getMyAccountDeletionStatusFromClient(sb);
    expect(r).toEqual({
      ok: true,
      status: {
        requestId: 'r1',
        requestedAt: '2026-09-10T10:00:00Z',
        deadlineAt: '2026-10-10T10:00:00Z',
        pendingPlayers: 2,
      },
    });
  });

  it('sin borrado en curso → ok con status null', async () => {
    const r = await getMyAccountDeletionStatusFromClient(makeClient({ data: [], error: null }));
    expect(r).toEqual({ ok: true, status: null });
  });

  it('ERROR → ok:false, distinguible de "no hay borrado"', async () => {
    // Confundirlos enseñaría la app normal a alguien con la cuenta EN BORRADO.
    const err = { message: 'boom' };
    const r = await getMyAccountDeletionStatusFromClient(makeClient({ data: null, error: err }));
    expect(r).toEqual({ ok: false, raw: err });
    expect(r.ok).toBe(false);
  });
});

describe('requestAccountDeletionFromClient', () => {
  it('devuelve requestId y bloqueantes', async () => {
    const sb = makeClient({ data: [{ request_id: 'r1', blocking_players: 2 }], error: null });
    const r = await requestAccountDeletionFromClient(sb, null);
    expect(r).toEqual({ ok: true, requestId: 'r1', blockingPlayers: 2 });
  });

  it('0 bloqueantes → el caller puede rematar el borrado en el acto', async () => {
    const sb = makeClient({ data: [{ request_id: 'r1', blocking_players: 0 }], error: null });
    const r = await requestAccountDeletionFromClient(sb, null);
    expect(r.ok && r.blockingPlayers).toBe(0);
  });

  it('motivo vacío o en blanco → p_reason undefined (PostgREST aplica el DEFAULT NULL)', async () => {
    const { client, rpc } = makeSpyClient({
      data: [{ request_id: 'r1', blocking_players: 0 }],
      error: null,
    });
    await requestAccountDeletionFromClient(client, '   ');
    expect(rpc).toHaveBeenCalledWith('request_account_deletion', { p_reason: undefined });
  });

  it('motivo recortado a 500 caracteres (el CHECK de la tabla)', async () => {
    const { client, rpc } = makeSpyClient({
      data: [{ request_id: 'r1', blocking_players: 0 }],
      error: null,
    });
    await requestAccountDeletionFromClient(client, 'x'.repeat(600));
    expect(rpc).toHaveBeenCalledWith('request_account_deletion', { p_reason: 'x'.repeat(500) });
  });

  it('sin fila devuelta → ok:false; no se puede afirmar que el borrado se registró', async () => {
    const r = await requestAccountDeletionFromClient(makeClient({ data: [], error: null }), null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('generic');
  });

  it('no_session → código propio', async () => {
    const r = await requestAccountDeletionFromClient(
      makeClient({ error: { message: 'no_session' } }),
      null,
    );
    expect(!r.ok && r.error).toBe('no_session');
  });
});

describe('cancelAccountDeletionFromClient', () => {
  it('cancelación correcta', async () => {
    const r = await cancelAccountDeletionFromClient(makeClient({ error: null }));
    expect(r).toEqual({ ok: true });
  });

  it('mapea los tres códigos de la RPC y el genérico', async () => {
    const cases: Array<[string, string]> = [
      ['no_session', 'no_session'],
      ['not_pending', 'not_pending'],
      ['admin_slot_taken', 'admin_slot_taken'],
      ['algo raro', 'generic'],
    ];
    for (const [msg, code] of cases) {
      const r = await cancelAccountDeletionFromClient(makeClient({ error: { message: msg } }));
      expect(!r.ok && r.error).toBe(code);
    }
  });

  it('el mensaje real de PostgREST trae prefijo y sufijo: se mapea igual', async () => {
    const raw = { message: 'admin_slot_taken\nCONTEXT: PL/pgSQL function cancel_account_deletion()' };
    const r = await cancelAccountDeletionFromClient(makeClient({ error: raw }));
    expect(!r.ok && r.error).toBe('admin_slot_taken');
    expect(!r.ok && r.raw).toBe(raw);
  });
});
