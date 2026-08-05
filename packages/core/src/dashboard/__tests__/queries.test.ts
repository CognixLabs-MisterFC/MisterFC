import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getClubDashboardBaseFromClient,
  getClubResultsFromClient,
  getClubAttendanceFromClient,
  getClubRankingsFromClient,
  getClubAlertsFromClient,
  getCampaignDeadlineAlertsFromClient,
} from '../queries';
import type { Database } from '../../supabase/types';

/** Mock por tabla con COLA (shift) — el orden de consumo por tabla es
 * determinista porque los loaders encadenan awaits (Promise.all solo mezcla
 * tablas distintas). Prueba que cada loader mapea la query y DELEGA en el
 * agregador puro correspondiente. */
type Term = { data?: unknown; error?: unknown };
function makeClient(responses: Record<string, Term[]>) {
  const next = (table: string): Term => {
    const arr = responses[table];
    if (!arr || arr.length === 0) throw new Error(`sin respuesta para ${table}`);
    return arr.shift()!;
  };
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single'])
      q[m] = chain;
    q.then = (onF: (v: Term) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(onF, onR);
    return q;
  };
  return { from: (t: string) => build(t) } as unknown as SupabaseClient<Database>;
}

const CLUB = 'cccccccc-0000-4000-8000-000000000001';

function team(id: string, name: string, catId = 'c1', catName = 'Alevín') {
  return { id, name, color: '#111', category_id: catId, categories: { name: catName, kind: 'alevin' } };
}

describe('dashboard loaders (FromClient) — delegan en agregadores puros', () => {
  it('getClubDashboardBase: resuelve activa/anterior y censa ambas', async () => {
    const sb = makeClient({
      seasons: [{ data: [{ label: '2025/26', status: 'active' }, { label: '2024/25', status: 'completed' }] }],
      teams: [{ data: [team('t1', 'Alevín A')] }, { data: [team('tp', 'Alevín A prev')] }],
      team_members: [
        { data: [{ player_id: 'p1', team_id: 't1' }, { player_id: 'p2', team_id: 't1' }] },
        { data: [{ player_id: 'p1', team_id: 'tp' }] },
      ],
    });
    const r = await getClubDashboardBaseFromClient(sb, CLUB);
    expect(r.season.activeSeason).toBe('2025/26');
    expect(r.season.previousSeason).toBe('2024/25');
    expect(r.season.teamIds).toEqual(['t1']);
    expect(r.census.totalPlayers).toBe(2);
    expect(r.previousCensus?.totalPlayers).toBe(1);
  });

  it('getClubDashboardBase: error de equipos → onError (Sentry en web), no revienta', async () => {
    const onError = vi.fn();
    const sb = makeClient({
      seasons: [{ data: [{ label: '2025/26', status: 'active' }] }],
      teams: [{ data: null, error: { message: 'boom' } }],
    });
    const r = await getClubDashboardBaseFromClient(sb, CLUB, { onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![1]).toMatchObject({ clubId: CLUB, season: '2025/26' });
    expect(r.census.totalPlayers).toBe(0);
  });

  it('getClubResults: mapea match_state y agrega por equipo', async () => {
    const sb = makeClient({
      match_state: [
        { data: [{ status: 'closed', goals_for: 3, goals_against: 1, events: { team_id: 't1', type: 'match' } }] },
      ],
    });
    const r = await getClubResultsFromClient(sb, ['t1']);
    expect(r[0]).toMatchObject({ teamId: 't1', played: 1, wins: 1 });
    expect(await getClubResultsFromClient(sb, [])).toEqual([]);
  });

  it('getClubAttendance: agrega y resuelve nombres del ranking', async () => {
    const sb = makeClient({
      training_attendance: [
        { data: [{ player_id: 'p1', code: 'present', event_id: 'e1', events: { team_id: 't1', type: 'training', starts_at: '2025-09-01' } }] },
      ],
      players: [{ data: [{ id: 'p1', first_name: 'Ana', last_name: 'Díaz' }] }],
    });
    const r = await getClubAttendanceFromClient(sb, ['t1']);
    expect(r.playerNames['p1']).toBe('Díaz, Ana');
    expect(r.agg.playerRanking.length).toBeGreaterThan(0);
  });

  it('getClubRankings: atribuye por categoría y lista goleadores', async () => {
    const sb = makeClient({
      teams: [{ data: [{ id: 't1', category_id: 'c1', categories: { name: 'Alevín' } }] }],
      match_player_stats: [{ data: [{ player_id: 'p1', goals: 5, team_id: 't1' }] }],
      evaluations: [{ data: [] }],
      players: [{ data: [{ id: 'p1', first_name: 'Ana', last_name: 'Díaz' }] }],
    });
    const r = await getClubRankingsFromClient(sb, ['t1']);
    expect(r.byCategory.map((c) => c.categoryName)).toContain('Alevín');
    expect(r.byCategory[0]!.topScorers[0]).toMatchObject({ playerId: 'p1', value: 5 });
    expect(r.playerNames['p1']).toBe('Díaz, Ana');
  });

  it('getClubAlerts: marca inactivos del roster (sin asistencia ni stats)', async () => {
    const sb = makeClient({
      team_members: [{ data: [{ player_id: 'p1', team_id: 't1', players: { first_name: 'Ana', last_name: 'Díaz' } }] }],
      training_attendance: [{ data: [] }],
      match_player_stats: [{ data: [] }],
    });
    const r = await getClubAlertsFromClient(sb, ['t1']);
    expect(r.inactive).toEqual([{ playerId: 'p1', name: 'Díaz, Ana', teamId: 't1' }]);
    expect(r.lowAttendance).toEqual([]);
  });

  it('getCampaignDeadlineAlerts: pendientes por campaña lanzada', async () => {
    const sb = makeClient({
      seasons: [{ data: { id: 's1' } }],
      assessment_campaigns: [{ data: [{ period: 'T1', due_date: '2026-01-01' }] }],
      team_members: [{ data: [{ player_id: 'p1', team_id: 't1' }, { player_id: 'p2', team_id: 't1' }] }],
      development_reports: [{ data: [] }],
    });
    const r = await getCampaignDeadlineAlertsFromClient(sb, CLUB, ['t1']);
    expect(r[0]).toMatchObject({ period: 'T1', pending: 2, pendingTeams: 1 });
  });
});
