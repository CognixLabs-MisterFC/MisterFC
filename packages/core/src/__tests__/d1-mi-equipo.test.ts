import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { teamScopedCacheKey } from '../offline/read-cache';
import {
  getPlayerTeamsFromClient,
  getTeamRosterStatsFromClient,
  getTeamStaffLightFromClient,
  getTeamHomeFromClient,
} from '../team-view/queries';
import { getSharedSessionsForTeamsFromClient } from '../sessions/queries';

type TableResult = { data?: unknown[] };

/** Mock table-aware: cada tabla resuelve a su resultado; soporta la cadena de
 * builders de PostgREST + rpc. maybeSingle → 1ª fila. */
function tableClient(
  tables: Record<string, TableResult>,
  rpc?: Record<string, { data?: unknown }>,
): SupabaseClient<Database> {
  const res = (table: string): TableResult => tables[table] ?? { data: [] };
  function builder(table: string) {
    const r = res(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'lte', 'gte', 'lt', 'is', 'or', 'not', 'limit']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (f: (v: TableResult) => unknown) => Promise.resolve(r).then(f);
    (chain as { maybeSingle: unknown }).maybeSingle = () =>
      Promise.resolve({ data: (r.data ?? [])[0] ?? null });
    return chain;
  }
  return {
    from: (tbl: string) => builder(tbl),
    rpc: async (name: string) => rpc?.[name] ?? { data: null },
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as unknown as SupabaseClient<Database>;
}

describe('D1 · teamScopedCacheKey (norma: id en la key)', () => {
  it('mete clubId Y teamId; cambiar de equipo → key distinta', () => {
    expect(teamScopedCacheKey('plantilla', 'C1', 'T1')).toBe('plantilla::C1::T1');
    expect(teamScopedCacheKey('plantilla', 'C1', 'T1')).not.toBe(
      teamScopedCacheKey('plantilla', 'C1', 'T2'),
    );
    expect(teamScopedCacheKey('staff', 'C1', 'T1')).toBe('staff::C1::T1');
    // El clubId también entra en la key: mismo equipo, club distinto → key distinta.
    expect(teamScopedCacheKey('plantilla', 'C1', 'T1')).not.toBe(
      teamScopedCacheKey('plantilla', 'C2', 'T1'),
    );
  });
});

describe('D1 · getPlayerTeamsFromClient (eje hijo activo)', () => {
  const tmRow = (playerId: string, teamId: string, season: string, clubId = 'C1') => ({
    player_id: playerId,
    team_id: teamId,
    teams: {
      id: teamId,
      name: `Equipo ${teamId}`,
      color: '#fff',
      format: 'F11',
      category_id: 'cat',
      season,
      categories: { name: 'Alevín', club_id: clubId, half_duration_minutes: 25 },
    },
  });

  it('sin playerIds → vacío (no consulta)', async () => {
    const sb = tableClient({});
    expect(await getPlayerTeamsFromClient(sb, 'C1', [], '2025-26')).toEqual([]);
  });

  it('filtra por club y por temporada activa; aplana la fila', async () => {
    const sb = tableClient({
      team_members: {
        data: [
          tmRow('P1', 'T1', '2025-26'),
          tmRow('P1', 'T2', '2024-25'), // temporada vieja → fuera
          tmRow('P1', 'T3', '2025-26', 'OTRO'), // otro club → fuera
        ],
      },
    });
    const teams = await getPlayerTeamsFromClient(sb, 'C1', ['P1'], '2025-26');
    expect(teams.map((t) => t.team_id)).toEqual(['T1']);
    expect(teams[0]).toMatchObject({
      player_id: 'P1',
      team_id: 'T1',
      name: 'Equipo T1',
      category_name: 'Alevín',
      half_duration_minutes: 25,
      season: '2025-26',
    });
  });
});

describe('D1 · getTeamRosterStatsFromClient (reusa aggregateTeamStats)', () => {
  it('roster vacío → []; con roster ordena por dorsal (sin dorsal al final)', async () => {
    expect(await getTeamRosterStatsFromClient(tableClient({ team_members: { data: [] } }), 'T1')).toEqual([]);

    const sb = tableClient({
      team_members: {
        data: [
          { player_id: 'B', dorsal_in_team: null, position_in_team: null },
          { player_id: 'A', dorsal_in_team: 9, position_in_team: 'DC' },
        ],
      },
      players_sporting: {
        data: [
          { id: 'A', first_name: 'Ana', last_name: 'A', dorsal: 9, position_main: 'DC', foot: 'right' },
          { id: 'B', first_name: 'Bea', last_name: 'B', dorsal: null, position_main: null, foot: null },
        ],
      },
      match_player_stats: { data: [] },
    });
    const roster = await getTeamRosterStatsFromClient(sb, 'T1');
    expect(roster.map((r) => r.player_id)).toEqual(['A', 'B']); // dorsal 9 antes que sin dorsal
    expect(roster[0]).toMatchObject({ dorsal: 9, position: 'DC', first_name: 'Ana' });
  });
});

describe('D1 · getTeamStaffLightFromClient (nombre+rol, agrupado por equipo)', () => {
  it('sin equipos → []; agrupa y ordena por nombre', async () => {
    expect(await getTeamStaffLightFromClient(tableClient({}), [])).toEqual([]);

    const sb = tableClient({
      team_staff: {
        data: [
          { id: 's2', team_id: 'T1', staff_role: 'entrenador_ayudante', memberships: { profiles: { full_name: 'Zoe' } } },
          { id: 's1', team_id: 'T1', staff_role: 'entrenador_principal', memberships: { profiles: { full_name: 'Ada' } } },
        ],
      },
    });
    const staff = await getTeamStaffLightFromClient(sb, [{ id: 'T1', name: 'Equipo T1', color: '#fff' }]);
    expect(staff).toHaveLength(1);
    expect(staff[0]!.members.map((m) => m.full_name)).toEqual(['Ada', 'Zoe']); // orden alfabético
  });
});

describe('D1 · getSharedSessionsForTeamsFromClient', () => {
  it('sin equipos → []; mapea team_name por id', async () => {
    expect(
      await getSharedSessionsForTeamsFromClient(tableClient({}), 'C1', [], '2026-01-01'),
    ).toEqual([]);

    const sb = tableClient({
      sessions: {
        data: [
          { id: 'S1', title: 'Sesión 1', session_date: '2026-02-01', total_minutes: 90, team_id: 'T1' },
          { id: 'S2', title: null, session_date: null, total_minutes: null, team_id: 'T1' }, // sin fecha → fuera
        ],
      },
    });
    const sessions = await getSharedSessionsForTeamsFromClient(
      sb,
      'C1',
      [{ id: 'T1', name: 'Alevín A' }],
      '2026-01-01',
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 'S1', team_name: 'Alevín A' });
  });
});

describe('D1 · getTeamHomeFromClient', () => {
  it('compañeros excluyen al jugador activo; anuncios club-wide + del equipo', async () => {
    const sb = tableClient({
      team_members: {
        data: [
          { player_id: 'ME', players: { id: 'ME', first_name: 'Yo', last_name: null, dorsal: 1, photo_url: null } },
          { player_id: 'P2', players: { id: 'P2', first_name: 'Otro', last_name: 'X', dorsal: 2, photo_url: null } },
        ],
      },
      events: { data: [] },
      announcements: {
        data: [
          { id: 'A1', title: 'Club', body: '', pinned: false, team_id: null, created_at: '2026-01-02' },
          { id: 'A2', title: 'Equipo', body: '', pinned: true, team_id: 'T1', created_at: '2026-01-01' },
          { id: 'A3', title: 'OtroEquipo', body: '', pinned: false, team_id: 'T9', created_at: '2026-01-03' },
        ],
      },
    });
    const home = await getTeamHomeFromClient(sb, 'C1', 'T1', 'ME', ['T1'], '2026-01-05T00:00:00.000Z');
    expect(home.teammates.map((t) => t.id)).toEqual(['P2']); // 'ME' excluido
    // A3 (equipo ajeno) fuera; A2 pinned primero.
    expect(home.announcements.map((a) => a.id)).toEqual(['A2', 'A1']);
  });
});
