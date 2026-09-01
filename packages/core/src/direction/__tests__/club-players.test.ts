import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getClubPlayersFromClient } from '../club-players';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';

/** Mock por tabla: cada tabla devuelve una respuesta canónica reutilizable. Los
 * filtros (.eq/.is) los aplica la BD; aquí se prueba el MAPEO puro (equipo activo,
 * cuenta). */
function makeClient(responses: Record<string, unknown>) {
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ['select', 'eq', 'is', 'not', 'in', 'order']) q[m] = chain;
    q.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(responses[table]).then(onF, onR);
    return q;
  };
  return { from: (t: string) => build(t) } as unknown as SupabaseClient<Database>;
}

function player(
  id: string,
  first: string,
  last: string,
  tms: Array<{ left_at: string | null; team: [string, string, string] | null }>,
  accounts = 0
) {
  return {
    id,
    first_name: first,
    last_name: last,
    date_of_birth: '2014-05-01',
    dorsal: 7,
    position_main: 'DEL',
    team_members: tms.map((tm) => ({
      team_id: tm.team ? tm.team[0] : null,
      left_at: tm.left_at,
      teams: tm.team ? { id: tm.team[0], name: tm.team[1], color: tm.team[2] } : null,
    })),
    player_accounts: Array.from({ length: accounts }, (_, i) => ({ profile_id: `p${i}` })),
  };
}

describe('getClubPlayersFromClient (directorio club-wide de dirección)', () => {
  it('mapea el equipo ACTIVO (pertenencia abierta) y noApp=false con cuenta', async () => {
    const sb = makeClient({
      players: {
        data: [
          player(
            'j1',
            'Ana',
            'Díaz',
            [
              { left_at: '2024-06-30', team: ['tOld', 'Viejo', '#000'] },
              { left_at: null, team: ['t1', 'Alevín A', '#111'] },
            ],
            1
          ),
        ],
      },
    });
    const r = await getClubPlayersFromClient(sb, CLUB);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: 'j1',
      firstName: 'Ana',
      lastName: 'Díaz',
      currentTeamId: 't1',
      currentTeamName: 'Alevín A',
      noApp: false,
    });
  });

  it('sin cuenta → noApp=true (un solo marcador: no se leen invitaciones)', async () => {
    const sb = makeClient({
      players: {
        data: [player('j3', 'Mia', 'Sanz', [{ left_at: null, team: ['t1', 'Alevín A', '#111'] }], 0)],
      },
    });
    const r = await getClubPlayersFromClient(sb, CLUB);
    expect(r[0]).toMatchObject({ noApp: true });
  });

  it('jugador sin pertenencia activa ni cuenta → sin equipo y noApp=true', async () => {
    const sb = makeClient({
      players: {
        data: [player('j2', 'Leo', 'Ruiz', [{ left_at: '2024-06-30', team: ['tOld', 'Viejo', '#000'] }], 0)],
      },
    });
    const r = await getClubPlayersFromClient(sb, CLUB);
    expect(r[0]).toMatchObject({ currentTeamId: null, currentTeamName: null, noApp: true });
  });

  it('sin jugadores → lista vacía', async () => {
    const sb = makeClient({ players: { data: [] } });
    expect(await getClubPlayersFromClient(sb, CLUB)).toEqual([]);
  });
});
