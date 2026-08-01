import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getFollowedPlayersFromClient } from '../spectators/index';
import { getClosedTeamMatchesFromClient } from '../match/closed-matches';
import { getWeekMatchesFromClient } from '../match/week-matches';
import { resolveActivePlayer, type FollowedPlayer } from '../auth/spectator';
import { eventScopedCacheKey } from '../offline/read-cache';

type TableResult = { data?: unknown[] };

/** Mock simple: cada tabla resuelve a un resultado fijo; ignora los filtros. */
function mockClient(tables: Record<string, TableResult>): SupabaseClient<Database> {
  const result = (t: string): TableResult => tables[t] ?? { data: [] };
  function builder(table: string) {
    const res = result(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'gte', 'lt']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (onF: (v: TableResult) => unknown) =>
      Promise.resolve(res).then(onF);
    return chain;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient<Database>;
}

// ─────────────────────────────────────────────────────────────────────────────
// getFollowedPlayersFromClient
// ─────────────────────────────────────────────────────────────────────────────

describe('O2-6 · getFollowedPlayersFromClient', () => {
  it('devuelve los jugadores seguidos con equipo, ordenados por nombre', async () => {
    const sb = mockClient({
      player_spectators: { data: [{ player_id: 'p2' }, { player_id: 'p1' }] },
      players_sporting: {
        data: [
          { id: 'p2', club_id: 'c1', first_name: 'Zoe', last_name: 'C' },
          { id: 'p1', club_id: 'c1', first_name: 'Ana', last_name: 'B' },
        ],
      },
      team_members: { data: [{ player_id: 'p1', team_id: 't1' }] },
      teams: { data: [{ id: 't1', name: 'Alevín A' }] },
    });

    const players = await getFollowedPlayersFromClient(sb, 'spec-1');

    expect(players).toHaveLength(2);
    // Orden por nombre: Ana B antes que Zoe C.
    expect(players[0]).toEqual({
      playerId: 'p1',
      clubId: 'c1',
      fullName: 'Ana B',
      teamId: 't1',
      teamName: 'Alevín A',
    });
    // El seguido sin equipo activo → teamId/teamName null.
    expect(players[1]).toEqual({
      playerId: 'p2',
      clubId: 'c1',
      fullName: 'Zoe C',
      teamId: null,
      teamName: null,
    });
  });

  it('sin filas en player_spectators → []', async () => {
    expect(await getFollowedPlayersFromClient(mockClient({}), 'spec-1')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getClosedTeamMatchesFromClient
// ─────────────────────────────────────────────────────────────────────────────

describe('O2-6 · getClosedTeamMatchesFromClient', () => {
  it('solo devuelve los partidos con match_state cerrado, con marcador', async () => {
    const sb = mockClient({
      events: {
        data: [
          { id: 'e1', title: 'J1', opponent_name: 'Rival', starts_at: '2026-01-02', teams: { name: 'Alevín A', categories: { name: 'Alevín' } } },
          { id: 'e2', title: 'J2', opponent_name: null, starts_at: '2026-01-09', teams: { name: 'Alevín A', categories: { name: 'Alevín' } } },
        ],
      },
      // e2 no está cerrado → no aparece.
      match_state: { data: [{ event_id: 'e1', status: 'closed', goals_for: 2, goals_against: 0 }] },
    });

    const matches = await getClosedTeamMatchesFromClient(sb, 't1');

    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      eventId: 'e1',
      title: 'J1',
      opponentName: 'Rival',
      startsAt: '2026-01-02',
      teamName: 'Alevín A',
      categoryName: 'Alevín',
      goalsOwn: 2,
      goalsRival: 0,
    });
  });

  it('sin eventos → []', async () => {
    expect(await getClosedTeamMatchesFromClient(mockClient({}), 't1')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getWeekMatchesFromClient — filtro teamId RETROCOMPATIBLE
// ─────────────────────────────────────────────────────────────────────────────

/** Mock que GRABA las llamadas .eq(col,val) sobre `events` para verificar el filtro. */
function recordingClient(events: unknown[], eqCalls: [string, unknown][]): SupabaseClient<Database> {
  function eventsBuilder() {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'gte', 'lt', 'order']) chain[m] = () => chain;
    chain.eq = (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    };
    (chain as { then: unknown }).then = (onF: (v: { data: unknown[] }) => unknown) =>
      Promise.resolve({ data: events }).then(onF);
    return chain;
  }
  function stateBuilder() {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'eq']) chain[m] = () => chain;
    (chain as { then: unknown }).then = (onF: (v: { data: unknown[] }) => unknown) =>
      Promise.resolve({ data: [] }).then(onF);
    return chain;
  }
  return {
    from: (t: string) => (t === 'events' ? eventsBuilder() : stateBuilder()),
  } as unknown as SupabaseClient<Database>;
}

const WEEK_EVENT = {
  id: 'e1',
  team_id: 't1',
  title: 'Partido',
  opponent_name: 'Rival',
  starts_at: '2026-01-01',
  teams: { name: 'Alevín A', color: '#f00', format: 'f7', categories: { name: 'Alevín', half_duration_minutes: 25 } },
};

describe('O2-6 · getWeekMatchesFromClient filtro teamId (retrocompatible)', () => {
  it('familia (sin opts) NO filtra por team_id', async () => {
    const eqCalls: [string, unknown][] = [];
    await getWeekMatchesFromClient(recordingClient([WEEK_EVENT], eqCalls), 'C1');
    expect(eqCalls.some(([col]) => col === 'team_id')).toBe(false);
    expect(eqCalls).toContainEqual(['club_id', 'C1']);
  });

  it('seguidor (opts.teamId) SÍ filtra por team_id', async () => {
    const eqCalls: [string, unknown][] = [];
    await getWeekMatchesFromClient(recordingClient([WEEK_EVENT], eqCalls), 'C1', { teamId: 't1' });
    expect(eqCalls).toContainEqual(['team_id', 't1']);
  });

  it('opts.teamId null (p.ej. seguido sin equipo) NO filtra', async () => {
    const eqCalls: [string, unknown][] = [];
    await getWeekMatchesFromClient(recordingClient([WEEK_EVENT], eqCalls), 'C1', { teamId: null });
    expect(eqCalls.some(([col]) => col === 'team_id')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Caché player-scoped del seguido + jugador seguido activo
// ─────────────────────────────────────────────────────────────────────────────

describe('O2-6 · keys de caché player-scoped (seguido)', () => {
  it('mete el playerId en la key; seguido distinto → key distinta', () => {
    expect(eventScopedCacheKey('spec-agenda', 'pA')).toBe('spec-agenda::pA');
    expect(eventScopedCacheKey('spec-agenda', 'pA')).not.toBe(
      eventScopedCacheKey('spec-agenda', 'pB'),
    );
    expect(eventScopedCacheKey('spec-directos', 'pA')).toBe('spec-directos::pA');
    expect(eventScopedCacheKey('spec-stats', 'pA')).toBe('spec-stats::pA');
    // el detalle es event-scoped (no cambia con el seguido, sino con el partido).
    expect(eventScopedCacheKey('spec-directo', 'e1')).toBe('spec-directo::e1');
  });
});

describe('O2-6 · jugador seguido activo (resolveActivePlayer con FollowedPlayer)', () => {
  const players: FollowedPlayer[] = [
    { playerId: 'p1', clubId: 'c1', fullName: 'Ana', teamId: 't1', teamName: 'A' },
    { playerId: 'p2', clubId: 'c1', fullName: 'Zoe', teamId: 't2', teamName: 'B' },
  ];

  it('uno solo → ese; sin guardado → el primero', () => {
    expect(resolveActivePlayer([players[0]!], null, (p) => p.playerId).active?.playerId).toBe('p1');
    const r = resolveActivePlayer(players, null, (p) => p.playerId);
    expect(r.active?.playerId).toBe('p1');
    expect(r.staleCookie).toBe(false);
  });

  it('guardado válido → ese; guardado obsoleto → primero + stale', () => {
    expect(resolveActivePlayer(players, 'p2', (p) => p.playerId).active?.playerId).toBe('p2');
    const stale = resolveActivePlayer(players, 'gone', (p) => p.playerId);
    expect(stale.active?.playerId).toBe('p1');
    expect(stale.staleCookie).toBe(true);
  });

  it('idOf por defecto lee playerId; sin jugadores → null', () => {
    expect(resolveActivePlayer(players, 'p2').active?.playerId).toBe('p2');
    expect(resolveActivePlayer([], 'x').active).toBeNull();
  });
});
