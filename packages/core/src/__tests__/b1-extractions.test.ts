import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { clubScopedCacheKey } from '../offline/read-cache';
import {
  getNotificationFeedFromClient,
  getUnreadNotificationsCountFromClient,
  markNotificationsReadFromClient,
} from '../notifications/feed';
import { getRecentAnnouncementsFromClient } from '../announcements/index';
import { getWeekMatchesFromClient } from '../match/week-matches';
import {
  getFollowableTeamsFromClient,
  setTeamFollowFromClient,
} from '../follows/index';
import { getUpcomingEventsFromClient } from '../home/index';

type TableResult = { data?: unknown[]; count?: number };

/**
 * Mock de supabase-js: cada tabla devuelve un resultado prefijado; toda la cadena
 * de filtros (.eq/.in/.gte/.order/.limit/.range/.update/.upsert/.delete/...) se
 * ignora y resuelve al resultado de la tabla. Sirve para testear el MAPEO/forma
 * de cada `getXFromClient`, no la corrección de los filtros (eso es RLS/SQL).
 */
function mockClient(config: {
  tables?: Record<string, TableResult>;
  rpc?: Record<string, unknown>;
  user?: { id: string } | null;
}): SupabaseClient<Database> {
  const result = (table: string): TableResult => config.tables?.[table] ?? { data: [] };
  function builder(table: string) {
    const res = result(table);
    const chain: Record<string, unknown> = {};
    for (const m of [
      'select', 'eq', 'in', 'gte', 'lte', 'lt', 'order', 'range', 'not',
      'or', 'is', 'update', 'upsert', 'delete', 'limit',
    ]) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (onF: (v: TableResult) => unknown) =>
      Promise.resolve(res).then(onF);
    (chain as { maybeSingle: unknown }).maybeSingle = () =>
      Promise.resolve({ data: (res.data ?? [])[0] ?? null });
    return chain;
  }
  return {
    from: (t: string) => builder(t),
    rpc: async (name: string) => ({ data: config.rpc?.[name] }),
    auth: { getUser: async () => ({ data: { user: config.user ?? null } }) },
  } as unknown as SupabaseClient<Database>;
}

describe('clubScopedCacheKey (norma de keys O2-5)', () => {
  it('mete el clubId en la key; club distinto → key distinta', () => {
    expect(clubScopedCacheKey('calendar', 'C1')).toBe('calendar::C1');
    expect(clubScopedCacheKey('calendar', 'C1')).not.toBe(
      clubScopedCacheKey('calendar', 'C2'),
    );
    expect(clubScopedCacheKey('directos', 'C1')).toBe('directos::C1');
  });
});

describe('notifications feed', () => {
  it('getNotificationFeedFromClient devuelve las filas in_app', async () => {
    const sb = mockClient({
      tables: { notifications: { data: [{ id: 'n1', type: 'goal', payload: {}, status: 'pending', created_at: 'x' }] } },
    });
    const rows = await getNotificationFeedFromClient(sb, 6);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('n1');
  });

  it('getUnreadNotificationsCountFromClient devuelve el count', async () => {
    const sb = mockClient({ tables: { notifications: { count: 4 } } });
    expect(await getUnreadNotificationsCountFromClient(sb)).toBe(4);
  });

  it('markNotificationsReadFromClient: sin tipos → 0; sin sesión → 0; con marcadas → n', async () => {
    expect((await markNotificationsReadFromClient(mockClient({}), [])).marked).toBe(0);
    const noUser = mockClient({ user: null, tables: { notifications: { data: [{ id: 'a' }] } } });
    expect((await markNotificationsReadFromClient(noUser, ['goal'] as never)).marked).toBe(0);
    const ok = mockClient({ user: { id: 'u1' }, tables: { notifications: { data: [{ id: 'a' }, { id: 'b' }] } } });
    expect((await markNotificationsReadFromClient(ok, ['goal'] as never)).marked).toBe(2);
  });
});

describe('anuncios', () => {
  it('mapea teamName del embed', async () => {
    const sb = mockClient({
      tables: { announcements: { data: [
        { id: 'a1', title: 'T', body: 'B', pinned: true, team_id: 't1', created_at: 'x', teams: { name: 'Infantil A' } },
        { id: 'a2', title: 'U', body: 'C', pinned: false, team_id: null, created_at: 'y', teams: null },
      ] } },
    });
    const anns = await getRecentAnnouncementsFromClient(sb, 'C1');
    expect(anns[0]!.teamName).toBe('Infantil A');
    expect(anns[1]!.teamName).toBeNull();
  });
});

describe('directos listado (getWeekMatchesFromClient)', () => {
  it('partido cerrado usa el marcador de match_state', async () => {
    const sb = mockClient({
      tables: {
        events: { data: [{ id: 'e1', title: 'Partido', opponent_name: 'Rival', starts_at: '2026-01-01', teams: { name: 'Alevín', color: '#f00', categories: { name: 'Alevín', half_duration_minutes: 25 } } }] },
        match_state: { data: [{ event_id: 'e1', status: 'closed', goals_for: 3, goals_against: 1 }] },
      },
    });
    const matches = await getWeekMatchesFromClient(sb, 'C1');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.status).toBe('closed');
    expect(matches[0]!.goalsOwn).toBe(3);
    expect(matches[0]!.goalsRival).toBe(1);
    expect(matches[0]!.halfDurationMinutes).toBe(25);
  });

  it('sin eventos → []', async () => {
    expect(await getWeekMatchesFromClient(mockClient({}), 'C1')).toEqual([]);
  });
});

describe('follows', () => {
  it('getFollowableTeamsFromClient marca following', async () => {
    const sb = mockClient({
      user: { id: 'u1' },
      tables: {
        seasons: { data: [{ label: '2025-26', status: 'active' }] },
        teams: { data: [
          { id: 't1', name: 'A', color: '#f00', categories: { name: 'Alevín' } },
          { id: 't2', name: 'B', color: '#0f0', categories: { name: 'Infantil' } },
        ] },
        team_follows: { data: [{ team_id: 't2' }] },
      },
    });
    const teams = await getFollowableTeamsFromClient(sb, 'C1');
    expect(teams.find((t) => t.teamId === 't2')!.following).toBe(true);
    expect(teams.find((t) => t.teamId === 't1')!.following).toBe(false);
  });

  it('setTeamFollowFromClient: sin sesión → forbidden; follow → ok', async () => {
    expect(await setTeamFollowFromClient(mockClient({ user: null }), 't1', true)).toEqual({ error: 'forbidden' });
    const ok = mockClient({ user: { id: 'u1' }, tables: { team_follows: { data: [] } } });
    expect(await setTeamFollowFromClient(ok, 't1', true)).toEqual({ ok: true, following: true });
    expect(await setTeamFollowFromClient(ok, 't1', false)).toEqual({ ok: true, following: false });
  });
});

describe('inicio', () => {
  it('getUpcomingEventsFromClient mapea teamName', async () => {
    const sb = mockClient({
      tables: { events: { data: [{ id: 'e1', title: 'Entreno', type: 'training', starts_at: 'x', team_id: 't1', teams: { name: 'Alevín A' } }] } },
    });
    const evs = await getUpcomingEventsFromClient(sb, 'a', 'b');
    expect(evs[0]!.teamName).toBe('Alevín A');
    expect(evs[0]!.type).toBe('training');
  });
});
