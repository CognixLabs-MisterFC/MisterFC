import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getClubTeamsFromClient } from '../queries';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';
const OTHER = 'cccccccc-0000-4000-8000-000000000002';

type Term = { data?: unknown };

/** Cliente mock por tabla (mismo patrón que messaging/create). `seasons` alimenta
 * getActiveSeasonLabelFromClient; `teams` la enumeración club-wide. */
function makeClient(responses: Record<string, Term[]>) {
  const next = (table: string): Term => {
    const arr = responses[table];
    if (!arr || arr.length === 0) throw new Error(`sin respuesta para ${table}`);
    return arr.shift()!;
  };
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = chain;
    q.order = chain;
    q.then = (onF: (v: Term) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(onF, onR);
    return q;
  };
  return { from: (table: string) => build(table) } as unknown as SupabaseClient<Database>;
}

function team(id: string, name: string, clubId = CLUB) {
  return {
    id,
    name,
    color: '#111',
    season: '2025/26',
    categories: { club_id: clubId, name: 'Alevín' },
  };
}

describe('getClubTeamsFromClient (picker club-wide de dirección)', () => {
  it('enumera todos los equipos del club, ordenados por nombre', async () => {
    const sb = makeClient({
      seasons: [{ data: [{ label: '2025/26', status: 'active' }] }],
      teams: [{ data: [team('t2', 'Benjamín B'), team('t1', 'Alevín A')] }],
    });
    const r = await getClubTeamsFromClient(sb, CLUB);
    expect(r.map((t) => t.name)).toEqual(['Alevín A', 'Benjamín B']);
    expect(r[0]).toMatchObject({ teamId: 't1', categoryName: 'Alevín' });
  });

  it('excluye equipos de OTRO club', async () => {
    const sb = makeClient({
      seasons: [{ data: [{ label: '2025/26', status: 'active' }] }],
      teams: [{ data: [team('t1', 'Alevín A'), team('tX', 'Otro', OTHER)] }],
    });
    const r = await getClubTeamsFromClient(sb, CLUB);
    expect(r.map((t) => t.teamId)).toEqual(['t1']);
  });

  it('sin equipos → lista vacía', async () => {
    const sb = makeClient({
      seasons: [{ data: [{ label: '2025/26', status: 'active' }] }],
      teams: [{ data: [] }],
    });
    const r = await getClubTeamsFromClient(sb, CLUB);
    expect(r).toEqual([]);
  });
});
