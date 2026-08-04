import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStaffTeamsFromClient } from '../queries';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';

function team(id: string, name: string, clubId = CLUB) {
  return {
    id,
    name,
    color: '#111',
    format: 'f7',
    season: '2025/26',
    categories: { id: `cat-${id}`, club_id: clubId, name: 'Alevín' },
  };
}

function makeClient(rows: unknown[]) {
  const client = {
    from(t: string) {
      expect(t).toBe('team_staff');
      const q = {
        select: () => q,
        eq: () => q,
        is: () => Promise.resolve({ data: rows, error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient<Database>;
  return client;
}

describe('getStaffTeamsFromClient', () => {
  it('mapea equipos de staff, ordenados por nombre', async () => {
    const client = makeClient([
      { team_id: 't2', staff_role: 'entrenador_principal', teams: team('t2', 'Benjamín B') },
      { team_id: 't1', staff_role: 'entrenador_ayudante', teams: team('t1', 'Alevín A') },
    ]);
    const r = await getStaffTeamsFromClient(client, { membershipId: 'm-1', clubId: CLUB });
    expect(r.map((t) => t.name)).toEqual(['Alevín A', 'Benjamín B']);
    expect(r[0]).toMatchObject({ teamId: 't1', staffRole: 'entrenador_ayudante', categoryName: 'Alevín' });
  });

  it('dedup por equipo: se queda el staff_role de mayor prioridad', async () => {
    const client = makeClient([
      { team_id: 't1', staff_role: 'coordinador', teams: team('t1', 'Alevín A') },
      { team_id: 't1', staff_role: 'entrenador_principal', teams: team('t1', 'Alevín A') },
    ]);
    const r = await getStaffTeamsFromClient(client, { membershipId: 'm-1', clubId: CLUB });
    expect(r).toHaveLength(1);
    expect(r[0]!.staffRole).toBe('entrenador_principal');
  });

  it('incluye al coordinador y excluye roles no-staff', async () => {
    const client = makeClient([
      { team_id: 't1', staff_role: 'coordinador', teams: team('t1', 'Alevín A') },
      { team_id: 't2', staff_role: 'jugador', teams: team('t2', 'Benjamín B') },
    ]);
    const r = await getStaffTeamsFromClient(client, { membershipId: 'm-1', clubId: CLUB });
    expect(r.map((t) => t.teamId)).toEqual(['t1']);
  });

  it('filtra equipos de OTRO club', async () => {
    const client = makeClient([
      { team_id: 't1', staff_role: 'entrenador_principal', teams: team('t1', 'Alevín A', 'otro-club') },
    ]);
    const r = await getStaffTeamsFromClient(client, { membershipId: 'm-1', clubId: CLUB });
    expect(r).toHaveLength(0);
  });
});
