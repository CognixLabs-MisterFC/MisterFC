import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLineupForEventFromClient } from '../queries';
import type { Database } from '../../supabase/types';

const CLUB = 'club-1';
const EVENT = 'ev-1';

/**
 * Mock table-aware. `events`/`coach_formations` responden `maybeSingle`; el resto se
 * awaitan (thenable → lista). `rpc` devuelve el gate. `.order()` es chainable.
 */
function makeClient(opts: {
  event?: unknown;
  canManage?: boolean;
  decisions?: Array<{ player_id: string; decision: string }>;
  lineups?: Array<{
    id: string;
    name: string;
    formation_code: string;
    is_official: boolean;
  }>;
  positions?: Array<{
    player_id: string;
    location: string;
    position_code: string | null;
    x_pct: number | null;
    y_pct: number | null;
  }>;
  roster?: unknown[];
  promotions?: unknown[];
  coachFormation?: unknown;
}): SupabaseClient<Database> {
  const listFor = (table: string): unknown[] => {
    switch (table) {
      case 'callup_decisions':
        return opts.decisions ?? [];
      case 'lineups':
        return opts.lineups ?? [];
      case 'lineup_positions':
        return opts.positions ?? [];
      case 'team_members':
        return opts.roster ?? [];
      case 'player_promotions':
        return opts.promotions ?? [];
      default:
        return [];
    }
  };
  const singleFor = (table: string): unknown => {
    if (table === 'events') return opts.event ?? null;
    if (table === 'coach_formations') return opts.coachFormation ?? null;
    return null;
  };

  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'lte', 'order']) builder[m] = () => builder;
    builder.maybeSingle = async () => ({ data: singleFor(table) });
    builder.then = (resolve: (v: { data: unknown[] }) => unknown) =>
      resolve({ data: listFor(table) });
    return builder;
  };

  return {
    from,
    rpc: async () => ({ data: opts.canManage ?? false }),
  } as unknown as SupabaseClient<Database>;
}

const baseEvent = {
  id: EVENT,
  club_id: CLUB,
  team_id: 't-1',
  type: 'match',
  tournament_id: null,
  title: 'Local vs Rival',
  opponent_name: 'Rival',
  starts_at: '2026-06-01T18:00:00Z',
  teams: {
    name: 'Alevín A',
    color: '#ff0000',
    format: 'F7',
    season: '2025/26',
    categories: { name: 'Alevín' },
  },
};

const rosterRow = (id: string, dorsal: number) => ({
  player_id: id,
  joined_at: '2020-01-01',
  left_at: null,
  players: {
    id,
    first_name: `N${dorsal}`,
    last_name: `A${dorsal}`,
    dorsal,
    position_main: 'midfielder',
  },
});

describe('O2-8a · getLineupForEventFromClient', () => {
  it('evento inexistente → null', async () => {
    const client = makeClient({ event: null });
    expect(
      await getLineupForEventFromClient(client, { clubId: CLUB, eventId: EVENT }),
    ).toBeNull();
  });

  it('evento de otro club → null', async () => {
    const client = makeClient({ event: { ...baseEvent, club_id: 'OTHER' } });
    expect(
      await getLineupForEventFromClient(client, { clubId: CLUB, eventId: EVENT }),
    ).toBeNull();
  });

  it('tipo no gestionable (training) → null', async () => {
    const client = makeClient({ event: { ...baseEvent, type: 'training' } });
    expect(
      await getLineupForEventFromClient(client, { clubId: CLUB, eventId: EVENT }),
    ).toBeNull();
  });

  it('sin alineación → view con lineupId null, positions vacío, lineupCount 0', async () => {
    const client = makeClient({ event: baseEvent, canManage: true, lineups: [] });
    const v = await getLineupForEventFromClient(client, {
      clubId: CLUB,
      eventId: EVENT,
    });
    expect(v).not.toBeNull();
    expect(v!.lineupId).toBeNull();
    expect(v!.positions).toEqual([]);
    expect(v!.lineupCount).toBe(0);
    expect(v!.canManage).toBe(true);
    expect(v!.event.format).toBe('F7');
  });

  it('alineación de catálogo (4-3-3): mapea posiciones, coachFormation null', async () => {
    const client = makeClient({
      event: baseEvent,
      canManage: true,
      lineups: [
        { id: 'l-1', name: 'Plan A', formation_code: '4-3-3', is_official: true },
      ],
      positions: [
        { player_id: 'p1', location: 'field', position_code: 'GK', x_pct: 50, y_pct: 92 },
        { player_id: 'p2', location: 'bench', position_code: null, x_pct: null, y_pct: null },
      ],
      roster: [rosterRow('p1', 1), rosterRow('p2', 2)],
    });
    const v = await getLineupForEventFromClient(client, {
      clubId: CLUB,
      eventId: EVENT,
    });
    expect(v!.formationCode).toBe('4-3-3');
    expect(v!.coachFormation).toBeNull();
    expect(v!.lineupName).toBe('Plan A');
    expect(v!.isOfficial).toBe(true);
    expect(v!.positions).toHaveLength(2);
    expect(v!.positions[0]).toEqual({
      playerId: 'p1',
      location: 'field',
      positionCode: 'GK',
      xPct: 50,
      yPct: 92,
    });
    expect(v!.roster).toHaveLength(2);
  });

  it('descartado con fila de posición huérfana → se excluye de positions', async () => {
    const client = makeClient({
      event: baseEvent,
      canManage: true,
      decisions: [{ player_id: 'p2', decision: 'discarded' }],
      lineups: [
        { id: 'l-1', name: 'Plan A', formation_code: '4-3-3', is_official: true },
      ],
      positions: [
        { player_id: 'p1', location: 'field', position_code: 'GK', x_pct: 50, y_pct: 92 },
        { player_id: 'p2', location: 'bench', position_code: null, x_pct: null, y_pct: null },
      ],
      roster: [rosterRow('p1', 1)],
    });
    const v = await getLineupForEventFromClient(client, {
      clubId: CLUB,
      eventId: EVENT,
    });
    expect(v!.positions.map((p) => p.playerId)).toEqual(['p1']);
  });

  it('formación = plantilla del coach (uuid) → trae coachFormation', async () => {
    const uuid = 'aaaaaaaa-1111-4111-8111-111111111111';
    const client = makeClient({
      event: baseEvent,
      canManage: true,
      lineups: [
        { id: 'l-1', name: 'Mi táctica', formation_code: uuid, is_official: false },
      ],
      positions: [],
      roster: [],
      coachFormation: {
        id: uuid,
        name: 'Mi 2-3-1',
        format: 'F7',
        positions: [],
      },
    });
    const v = await getLineupForEventFromClient(client, {
      clubId: CLUB,
      eventId: EVENT,
    });
    expect(v!.formationCode).toBe(uuid);
    expect(v!.coachFormation).not.toBeNull();
    expect(v!.coachFormation!.name).toBe('Mi 2-3-1');
  });
});
