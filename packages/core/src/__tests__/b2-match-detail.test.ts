import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getMatchDetailFromClient } from '../match/detail';
import { getSportingNamesFromClient } from '../player-profile/sporting-names';
import { eventScopedCacheKey } from '../offline/read-cache';

type TableResult = { data?: unknown[] };

/**
 * Mock supabase-js: cada tabla devuelve un resultado prefijado; la cadena de
 * filtros (.eq/.in/.order/…) se ignora y resuelve al resultado de la tabla.
 * `maybeSingle` devuelve la primera fila. Testea el MAPEO/forma del detalle, no la
 * corrección de los filtros (eso es RLS/SQL).
 */
function mockClient(tables: Record<string, TableResult>): SupabaseClient<Database> {
  const result = (table: string): TableResult => tables[table] ?? { data: [] };
  function builder(table: string) {
    const res = result(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'lte', 'gte', 'not', 'is']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (onF: (v: TableResult) => unknown) =>
      Promise.resolve(res).then(onF);
    (chain as { maybeSingle: unknown }).maybeSingle = () =>
      Promise.resolve({ data: (res.data ?? [])[0] ?? null });
    return chain;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient<Database>;
}

const EVENT_MATCH = {
  id: 'e1',
  club_id: 'C1',
  team_id: 't1',
  type: 'match',
  title: 'Partido',
  opponent_name: 'Rival CF',
  starts_at: '2026-01-10T10:00:00.000Z',
  teams: {
    name: 'Alevín A',
    color: '#ff0000',
    format: 'F7',
    categories: { name: 'Alevín', half_duration_minutes: 25 },
  },
};

describe('getMatchDetailFromClient (B2)', () => {
  it('evento de OTRO club → null (aislamiento)', async () => {
    const sb = mockClient({ events: { data: [{ ...EVENT_MATCH, club_id: 'OTHER' }] } });
    expect(await getMatchDetailFromClient(sb, 'C1', 'e1')).toBeNull();
  });

  it('tipo no-partido (training) → null', async () => {
    const sb = mockClient({ events: { data: [{ ...EVENT_MATCH, type: 'training' }] } });
    expect(await getMatchDetailFromClient(sb, 'C1', 'e1')).toBeNull();
  });

  it('evento inexistente → null', async () => {
    expect(await getMatchDetailFromClient(mockClient({}), 'C1', 'e1')).toBeNull();
  });

  it('partido cerrado: marcador (computeScore), campo y timeline mapeados', async () => {
    const sb = mockClient({
      events: { data: [EVENT_MATCH] },
      match_state: { data: [{ status: 'closed', live_positions: null }] },
      match_periods: { data: [] },
      lineups: { data: [{ id: 'l1', formation_code: '4-3-3' }] },
      lineup_positions: {
        data: [
          {
            player_id: 'p1',
            position_code: 'GK',
            x_pct: 50,
            y_pct: 90,
            players: { first_name: 'Ana', last_name: 'García', dorsal: 1 },
          },
        ],
      },
      match_events: {
        data: [
          {
            id: 'g1', side: 'own', type: 'goal', player_id: 'p1', rival_dorsal: null,
            clock_seconds: 120, display_minute: 2, period: 'first_half', metadata: {},
            players: { first_name: 'Ana', last_name: 'García', dorsal: 1 },
          },
          {
            id: 'g2', side: 'rival', type: 'goal', player_id: null, rival_dorsal: 9,
            clock_seconds: 300, display_minute: 5, period: 'first_half', metadata: {},
            players: null,
          },
        ],
      },
    });
    const d = await getMatchDetailFromClient(sb, 'C1', 'e1');
    expect(d).not.toBeNull();
    expect(d!.status).toBe('closed');
    expect(d!.goalsOwn).toBe(1);
    expect(d!.goalsRival).toBe(1);
    expect(d!.hasLineup).toBe(true);
    expect(d!.fieldPlayers).toHaveLength(1);
    expect(d!.fieldPlayers[0]!.label).toBe('García');
    expect(d!.fieldPlayers[0]!.dorsal).toBe(1);
    expect(d!.fieldPlayers[0]!.xPct).toBe(50);
    expect(d!.events).toHaveLength(2);
    expect(d!.events[0]!.label).toBe('García');
    expect(d!.events[1]!.label).toBe('#9');
    expect(d!.halfDurationMinutes).toBe(25);
  });

  it('sin alineación oficial → hasLineup false, formación por defecto del formato', async () => {
    const sb = mockClient({
      events: { data: [EVENT_MATCH] },
      match_state: { data: [{ status: 'not_started', live_positions: null }] },
      match_periods: { data: [] },
      lineups: { data: [] },
      match_events: { data: [] },
    });
    const d = await getMatchDetailFromClient(sb, 'C1', 'e1');
    expect(d!.hasLineup).toBe(false);
    expect(d!.fieldPlayers).toEqual([]);
    expect(d!.formationCode.length).toBeGreaterThan(0);
  });
});

describe('getSportingNamesFromClient (rama seguidor)', () => {
  it('mapea player_id → nombre deportivo; ids vacíos → mapa vacío', async () => {
    const sb = mockClient({
      players_sporting: { data: [{ id: 'p1', first_name: 'Ana', last_name: 'García', dorsal: 7 }] },
    });
    const map = await getSportingNamesFromClient(sb, ['p1', null, undefined]);
    expect(map.get('p1')).toEqual({ first_name: 'Ana', last_name: 'García', dorsal: 7 });
    expect((await getSportingNamesFromClient(sb, [])).size).toBe(0);
  });
});

describe('eventScopedCacheKey (norma de keys B2)', () => {
  it('mete el eventId en la key; evento distinto → key distinta', () => {
    expect(eventScopedCacheKey('directo', 'E1')).toBe('directo.E1');
    expect(eventScopedCacheKey('directo', 'E1')).not.toBe(eventScopedCacheKey('directo', 'E2'));
  });
});
