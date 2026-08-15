import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearAttendanceFromClient,
  markAttendanceFromClient,
} from '../staff-writes';
import { resolveAttendanceScopeFromClient } from '../scope';
import { eventScopedCacheKey } from '../../offline/read-cache';
import type { Database } from '../../supabase/types';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Mock de SupabaseClient para las escrituras de asistencia. Cuenta cuántas veces se
 * llama update/insert/delete y con qué, y devuelve un existing-row programable para
 * ejercitar las dos ramas del upsert incremental (UPDATE vs INSERT).
 */
type WriteCalls = {
  updates: Array<{ patch: unknown; id: unknown }>;
  inserts: unknown[];
  deletes: number;
};

function makeClient(opts: {
  existing?: { id: string } | null;
  updateError?: { code?: string; message?: string } | null;
  insertError?: { code?: string; message?: string } | null;
  deleteError?: { code?: string; message?: string } | null;
  user?: { id: string } | null;
}): { client: SupabaseClient<Database>; calls: WriteCalls } {
  const calls: WriteCalls = { updates: [], inserts: [], deletes: 0 };

  const from = (_table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) {
      builder[m] = () => builder;
    }
    builder.maybeSingle = async () => ({ data: opts.existing ?? null });
    builder.update = (patch: unknown) => ({
      eq: (_col: string, id: unknown) => {
        calls.updates.push({ patch, id });
        return Promise.resolve({ error: opts.updateError ?? null });
      },
    });
    builder.insert = (row: unknown) => {
      calls.inserts.push(row);
      return Promise.resolve({ error: opts.insertError ?? null });
    };
    builder.delete = () => ({
      eq: () => ({
        eq: () => {
          calls.deletes += 1;
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      }),
    });
    return builder;
  };

  const client = {
    from,
    auth: { getUser: async () => ({ data: { user: opts.user ?? null } }) },
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

describe('O2-7a · markAttendanceFromClient (incremental)', () => {
  it('sin fila existente → UN INSERT (con recorded_by = user), cero UPDATE', async () => {
    const { client, calls } = makeClient({ existing: null, user: { id: 'coach-1' } });
    const res = await markAttendanceFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      code: 'presente',
    });
    expect(res).toEqual({ ok: true });
    expect(calls.inserts).toHaveLength(1);
    expect(calls.updates).toHaveLength(0);
    expect((calls.inserts[0] as { recorded_by: string }).recorded_by).toBe('coach-1');
  });

  it('con fila existente → UN UPDATE de code/notes, cero INSERT', async () => {
    const { client, calls } = makeClient({ existing: { id: 'row-1' } });
    const res = await markAttendanceFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      code: 'lesionado',
    });
    expect(res).toEqual({ ok: true });
    expect(calls.updates).toHaveLength(1);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates[0]!.patch).toMatchObject({ code: 'lesionado' });
    expect(calls.updates[0]!.id).toBe('row-1');
  });

  it('cada marca persiste sola: dos marcas de jugadores distintos → dos escrituras', async () => {
    const { client, calls } = makeClient({ existing: null, user: { id: 'coach-1' } });
    await markAttendanceFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      code: 'presente',
    });
    await markAttendanceFromClient(client, {
      event_id: EVENT_ID,
      player_id: '33333333-3333-4333-8333-333333333333',
      code: 'ausente',
    });
    // No hay batch: una escritura por marca.
    expect(calls.inserts).toHaveLength(2);
  });

  it('INSERT rechazado por RLS (42501) → forbidden (sin crash)', async () => {
    const { client } = makeClient({
      existing: null,
      user: { id: 'coach-1' },
      insertError: { code: '42501' },
    });
    const res = await markAttendanceFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      code: 'presente',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('error de trigger (event_in_future) → se propaga el código', async () => {
    const { client } = makeClient({
      existing: { id: 'row-1' },
      updateError: { message: 'event_in_future' },
    });
    const res = await markAttendanceFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      code: 'presente',
    });
    expect(res).toEqual({ ok: false, error: 'event_in_future' });
  });

  it('event_id no-UUID → validación event_invalid (sin tocar la BD)', async () => {
    const { client, calls } = makeClient({ existing: null });
    const res = await markAttendanceFromClient(client, {
      event_id: 'not-a-uuid',
      player_id: PLAYER_ID,
      code: 'presente',
    });
    expect(res).toEqual({ ok: false, error: 'event_invalid' });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });

  it('INSERT sin sesión (user null) → forbidden', async () => {
    const { client } = makeClient({ existing: null, user: null });
    const res = await markAttendanceFromClient(client, {
      event_id: EVENT_ID,
      player_id: PLAYER_ID,
      code: 'presente',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('O2-7a · clearAttendanceFromClient', () => {
  it('borra la fila → ok', async () => {
    const { client } = makeClient({});
    const res = await clearAttendanceFromClient(client, EVENT_ID, PLAYER_ID);
    expect(res).toEqual({ ok: true });
  });

  it('DELETE 42501 → forbidden', async () => {
    const { client } = makeClient({ deleteError: { code: '42501' } });
    const res = await clearAttendanceFromClient(client, EVENT_ID, PLAYER_ID);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('O2-7a · resolveAttendanceScopeFromClient', () => {
  it('admin_club → all (sin consultar la BD)', async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient<Database>;
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'admin_club',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'all' });
    expect(from).not.toHaveBeenCalled();
  });

  it('entrenador_ayudante → restricted a sus equipos del club', async () => {
    const rows = [
      { team_id: 't-1', memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      { team_id: 't-2', memberships: { profile_id: 'u-1', club_id: 'OTHER' } },
      { team_id: 't-3', memberships: { profile_id: 'OTHER', club_id: 'club-1' } },
    ];
    const client = {
      from: () => ({
        select: () => ({ is: async () => ({ data: rows }) }),
      }),
    } as unknown as SupabaseClient<Database>;
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_ayudante',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'restricted', teamIds: ['t-1'] });
  });

  it('sin userId → none', async () => {
    const client = {} as unknown as SupabaseClient<Database>;
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_principal',
      userId: null,
    });
    expect(scope).toEqual({ kind: 'none' });
  });
});

describe('O2-7a · cache key de la sesión lleva el eventId', () => {
  it('eventScopedCacheKey incluye el id del evento', () => {
    const key = eventScopedCacheKey('asistencia-sesion', EVENT_ID);
    expect(key).toBe(`asistencia-sesion.${EVENT_ID}`);
    expect(key).toContain(EVENT_ID);
  });
});
