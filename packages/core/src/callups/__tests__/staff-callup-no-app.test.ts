import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { getStaffCallupDetailFromClient } from '../staff-queries';

/**
 * Slice C — el detalle de convocatoria del STAFF trae `no_app` por jugador (marcador
 * "Sin app"); la rama FAMILIA (scope 'player') NI lo trae NI consulta `players`
 * (misma guarda que la asistencia semanal). Solo presentación: nada más cambia.
 */

type TableResult = { data?: unknown[] };

function tableClient(tables: Record<string, TableResult>) {
  const seen: string[] = [];
  const res = (table: string): TableResult => tables[table] ?? { data: [] };
  function builder(table: string) {
    seen.push(table);
    const r = res(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'lte', 'gte', 'lt', 'is', 'or', 'not', 'limit']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (f: (v: unknown) => unknown) =>
      Promise.resolve({ data: r.data ?? [], error: null }).then(f);
    (chain as { maybeSingle: unknown }).maybeSingle = () =>
      Promise.resolve({ data: (r.data ?? [])[0] ?? null, error: null });
    return chain;
  }
  const client = {
    from: (tbl: string) => builder(tbl),
    rpc: async () => ({ data: false }),
  } as unknown as SupabaseClient<Database>;
  return { client, seen };
}

const EVENT = {
  id: 'E1',
  club_id: 'C1',
  team_id: 'T1',
  type: 'match',
  tournament_id: null,
  title: 'Partido',
  opponent_name: 'Rival',
  starts_at: '2026-09-05T10:00:00.000Z',
  location_name: null,
  location_address: null,
  teams: {
    name: 'Alevín A',
    color: '#000',
    season: '2026-27',
    format: 'f7',
    categories: { name: 'Alevín' },
  },
};

const member = (playerId: string, first: string) => ({
  player_id: playerId,
  joined_at: '2026-08-01',
  left_at: null,
  players: { id: playerId, first_name: first, last_name: 'Test', dorsal: null },
});

const tables = {
  events: { data: [EVENT] },
  team_members: { data: [member('p1', 'Ana'), member('p2', 'Bea'), member('p3', 'Cris')] },
  players: {
    data: [
      { id: 'p1', player_accounts: [{ profile_id: 'u1' }] },
      { id: 'p2', player_accounts: [] },
      { id: 'p3', player_accounts: [] },
    ],
  },
};

describe('Slice C · getStaffCallupDetailFromClient + no_app', () => {
  it('staff (scope all): marca a los que no tienen familia en la app', async () => {
    const { client } = tableClient(tables);
    const detail = await getStaffCallupDetailFromClient(client, {
      clubId: 'C1',
      role: 'admin_club',
      userId: 'u9',
      eventId: 'E1',
    });
    const byId = Object.fromEntries((detail?.roster ?? []).map((p) => [p.id, p.no_app]));
    expect(byId).toEqual({ p1: false, p2: true, p3: true });
  });

  it('familia (scope player): sin no_app y SIN consultar players', async () => {
    const { client, seen } = tableClient({
      ...tables,
      player_accounts: { data: [{ player_id: 'p1', players: { club_id: 'C1' } }] },
    });
    const detail = await getStaffCallupDetailFromClient(client, {
      clubId: 'C1',
      role: 'jugador',
      userId: 'u1',
      eventId: 'E1',
    });
    expect(detail?.roster.map((p) => p.id)).toEqual(['p1']);
    expect(detail?.roster[0]?.no_app).toBeUndefined();
    expect(seen).not.toContain('players');
  });
});
