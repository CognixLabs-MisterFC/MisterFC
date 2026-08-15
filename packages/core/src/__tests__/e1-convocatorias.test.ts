import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  playerScopedCacheKey,
  playerEventScopedCacheKey,
} from '../offline/read-cache';
import {
  getPlayerCallupsFromClient,
  getPlayerCallupDetailFromClient,
  respondCallupFromClient,
} from '../callups/queries';
import {
  getAttendanceStatsFromClient,
  attendanceStatsWindow,
} from '../attendance/stats-queries';
import { getFamilyMatchStatRowsFromClient } from '../match/family-stats';

type TableResult = { data?: unknown[] };

/**
 * Mock table-aware: cada tabla resuelve a su resultado (mismo resultado para todas
 * las variantes de filtro — el test escoge datos que sirven a ambas lecturas).
 * `update`/`insert` resuelven sin error; `auth.getUser` devuelve el user dado.
 */
function tableClient(
  tables: Record<string, TableResult>,
  user: { id: string } | null = { id: 'U1' },
): SupabaseClient<Database> {
  const res = (table: string): TableResult => tables[table] ?? { data: [] };
  function builder(table: string) {
    const r = res(table);
    const chain: Record<string, unknown> = {};
    for (const m of [
      'select', 'eq', 'in', 'order', 'limit', 'is', 'or', 'not', 'gte', 'lte',
      'update', 'insert',
    ]) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (f: (v: TableResult) => unknown) =>
      Promise.resolve(r).then(f);
    (chain as { maybeSingle: unknown }).maybeSingle = () =>
      Promise.resolve({ data: (r.data ?? [])[0] ?? null });
    return chain;
  }
  return {
    from: (tbl: string) => builder(tbl),
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
  } as unknown as SupabaseClient<Database>;
}

describe('E1 · keys de caché player-scoped', () => {
  it('convocatorias/asistencia cambian con el hijo', () => {
    expect(playerScopedCacheKey('convocatorias', 'C1', 'P1')).toBe('convocatorias.C1.P1');
    expect(playerScopedCacheKey('convocatorias', 'C1', 'P1')).not.toBe(
      playerScopedCacheKey('convocatorias', 'C1', 'P2'),
    );
    expect(playerScopedCacheKey('asistencia', 'C1', 'P1')).not.toBe(
      playerScopedCacheKey('asistencia', 'C1', 'P2'),
    );
  });

  it('player+event (detalle/stats) cambia con el hijo AUNQUE el evento sea el mismo', () => {
    const a = playerEventScopedCacheKey('convocatoria', 'C1', 'P1', 'E1');
    const b = playerEventScopedCacheKey('convocatoria', 'C1', 'P2', 'E1');
    expect(a).toBe('convocatoria.C1.P1.E1');
    expect(a).not.toBe(b); // mismo evento, hijo distinto → key distinta
    expect(playerEventScopedCacheKey('stats-partido', 'C1', 'P1', 'E1')).not.toBe(
      playerEventScopedCacheKey('stats-partido', 'C1', 'P1', 'E2'),
    );
  });
});

describe('E1 · attendanceStatsWindow', () => {
  it('season = 1 de agosto del curso; antes de agosto usa el año anterior', () => {
    const w1 = attendanceStatsWindow('season', new Date('2026-03-15T00:00:00Z'));
    expect(w1.startIso).toBe(new Date(Date.UTC(2025, 7, 1)).toISOString());
    const w2 = attendanceStatsWindow('season', new Date('2026-09-15T00:00:00Z'));
    expect(w2.startIso).toBe(new Date(Date.UTC(2026, 7, 1)).toISOString());
  });
});

describe('E1 · getPlayerCallupsFromClient', () => {
  it('mapea la respuesta y decisión del hijo; can_record_match=false', async () => {
    const sb = tableClient({
      team_members: {
        data: [{ team_id: 'T1', player_id: 'P1', joined_at: '2020-01-01', left_at: null }],
      },
      events: {
        data: [
          {
            id: 'E1', club_id: 'C1', team_id: 'T1', type: 'match', tournament_id: null,
            round: null, title: 'Jornada 1', opponent_name: 'Rival', starts_at: '2026-08-01T10:00:00Z',
            teams: { name: 'Infantil A', color: '#000', season: '25/26', categories: { name: 'Infantil' } },
          },
        ],
      },
      match_callup_meta: {
        data: [{ event_id: 'E1', meeting_at: '2026-08-01T09:00:00Z', meeting_location: 'Campo', published_at: '2026-07-01' }],
      },
      callup_responses: { data: [{ event_id: 'E1', player_id: 'P1', status: 'yes' }] },
      callup_decisions: { data: [] },
    });
    const rows = await getPlayerCallupsFromClient(sb, 'C1', ['P1'], {
      fromIso: '2026-01-01', toIso: '2026-12-31',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.my_response).toBe('yes');
    expect(rows[0]!.published).toBe(true);
    expect(rows[0]!.my_decision).toBe('called_up');
    expect(rows[0]!.can_record_match).toBe(false);
    expect(rows[0]!.roster_count).toBe(1);
  });

  it('sin equipos → lista vacía', async () => {
    const sb = tableClient({ team_members: { data: [] } });
    expect(await getPlayerCallupsFromClient(sb, 'C1', ['P1'], { fromIso: 'a', toIso: 'b' })).toEqual([]);
  });
});

describe('E1 · getPlayerCallupDetailFromClient', () => {
  it('devuelve solo al hijo con su respuesta y decisión', async () => {
    const sb = tableClient({
      events: {
        data: [
          {
            id: 'E1', club_id: 'C1', team_id: 'T1', type: 'match', tournament_id: null,
            title: 'Jornada 1', opponent_name: 'Rival', starts_at: '2026-08-01T10:00:00Z',
            location_name: 'Campo', location_address: null,
            teams: { name: 'Infantil A', color: '#000', season: '25/26', categories: { name: 'Infantil' } },
          },
        ],
      },
      team_members: {
        data: [
          { player_id: 'P1', joined_at: '2020-01-01', left_at: null, players: { id: 'P1', first_name: 'Leo', last_name: 'Díaz', dorsal: 10 } },
        ],
      },
      player_promotions: { data: [] },
      match_callup_meta: { data: [{ meeting_at: null, meeting_location: 'Campo', meeting_address: null, transport_mode: null, transport_notes: null, notes_general: null, published_at: '2026-07-01' }] },
      callup_responses: { data: [{ player_id: 'P1', status: 'maybe', reason: 'Duda' }] },
      callup_decisions: { data: [] },
    });
    const detail = await getPlayerCallupDetailFromClient(sb, 'C1', 'E1', ['P1']);
    expect(detail).not.toBeNull();
    expect(detail!.players).toHaveLength(1);
    expect(detail!.players[0]!.response).toBe('maybe');
    expect(detail!.players[0]!.decision).toBe('called_up');
    expect(detail!.published).toBe(true);
  });

  it('evento de otro club → null', async () => {
    const sb = tableClient({
      events: { data: [{ id: 'E1', club_id: 'OTRO', team_id: 'T1', type: 'match', starts_at: '2026-08-01', teams: { name: '', color: '', season: '', categories: { name: '' } } }] },
    });
    expect(await getPlayerCallupDetailFromClient(sb, 'C1', 'E1', ['P1'])).toBeNull();
  });
});

describe('E1 · respondCallupFromClient', () => {
  it('sin usuario → noUser (el front lo mapea a forbidden)', async () => {
    const sb = tableClient({}, null);
    const res = await respondCallupFromClient(sb, { event_id: 'E1', player_id: 'P1', status: 'yes', reason: null });
    expect(res).toEqual({ ok: false, noUser: true });
  });

  it('con usuario → ok (insert cuando no existe)', async () => {
    const sb = tableClient({ callup_responses: { data: [] } });
    const res = await respondCallupFromClient(sb, { event_id: 'E1', player_id: 'P1', status: 'no', reason: 'Lesión' });
    expect(res).toEqual({ ok: true });
  });
});

describe('E1 · getAttendanceStatsFromClient', () => {
  it('agrega por jugador con % de presencia y filtra por scope player', async () => {
    const sb = tableClient({
      training_attendance: {
        data: [
          { code: 'presente', player_id: 'P1', events: { club_id: 'C1', team_id: 'T1', teams: { id: 'T1', name: 'Inf A' } }, players: { id: 'P1', first_name: 'Leo', last_name: 'Díaz' } },
          { code: 'ausente', player_id: 'P1', events: { club_id: 'C1', team_id: 'T1', teams: { id: 'T1', name: 'Inf A' } }, players: { id: 'P1', first_name: 'Leo', last_name: 'Díaz' } },
          { code: 'presente', player_id: 'P9', events: { club_id: 'C1', team_id: 'T1', teams: { id: 'T1', name: 'Inf A' } }, players: { id: 'P9', first_name: 'Otro', last_name: 'X' } },
        ],
      },
    });
    const stats = await getAttendanceStatsFromClient(sb, {
      clubId: 'C1',
      scope: { kind: 'player', playerIds: ['P1'] },
      startIso: 'a', endIso: 'b',
    });
    expect(stats.byPlayer).toHaveLength(1); // P9 filtrado por scope
    expect(stats.byPlayer[0]!.total).toBe(2);
    expect(stats.byPlayer[0]!.present).toBe(1);
    expect(stats.byPlayer[0]!.unjustified).toBe(1);
    expect(stats.byPlayer[0]!.pct_present).toBe(50);
  });
});

describe('E1 · getFamilyMatchStatRowsFromClient', () => {
  it('devuelve la fila del hijo; vacío si no participó', async () => {
    const sb = tableClient({
      match_player_stats: {
        data: [
          { player_id: 'P1', started: true, minutes_played: 60, goals: 2, assists: 1, yellow_cards: 0, red_cards: 0, shots: 3, fouls_committed: 1, fouls_received: 2, penalties_scored: 0, penalties_missed: 0 },
        ],
      },
      players: { data: [{ id: 'P1', first_name: 'Leo', last_name: 'Díaz', dorsal: 10 }] },
    });
    const rows = await getFamilyMatchStatRowsFromClient(sb, 'E1', ['P1']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.goals).toBe(2);
    expect(rows[0]!.firstName).toBe('Leo');

    const empty = await getFamilyMatchStatRowsFromClient(tableClient({ match_player_stats: { data: [] } }), 'E1', ['P1']);
    expect(empty).toEqual([]);
  });
});
