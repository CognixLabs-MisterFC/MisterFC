import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getClubStaffFromClient } from '../club-staff';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';
const OTHER = 'cccccccc-0000-4000-8000-000000000002';

function makeClient(responses: Record<string, unknown>) {
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ['select', 'is']) q[m] = chain;
    q.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(responses[table]).then(onF, onR);
    return q;
  };
  return { from: (t: string) => build(t) } as unknown as SupabaseClient<Database>;
}

function staffRow(
  id: string,
  membershipId: string,
  fullName: string,
  role: string,
  team: [string, string],
  joinedAt: string,
  clubId = CLUB
) {
  return {
    id,
    staff_role: 'entrenador_principal',
    joined_at: joinedAt,
    team_id: team[0],
    membership_id: membershipId,
    teams: { id: team[0], name: team[1], color: '#111', categories: { club_id: clubId } },
    memberships: {
      id: membershipId,
      role,
      club_id: clubId,
      profile_id: `prof-${membershipId}`,
      profiles: { id: `prof-${membershipId}`, full_name: fullName },
    },
  };
}

describe('getClubStaffFromClient (cuerpo técnico club-wide de dirección)', () => {
  it('agrupa por membresía con sus asignaciones y ordena por nombre', async () => {
    const sb = makeClient({
      team_staff: {
        data: [
          staffRow('s1', 'm2', 'Zoe Vega', 'entrenador_principal', ['t1', 'Alevín A'], '2025-09-01'),
          staffRow('s2', 'm1', 'Ana Díaz', 'entrenador_ayudante', ['t1', 'Alevín A'], '2025-08-01'),
          staffRow('s3', 'm1', 'Ana Díaz', 'entrenador_ayudante', ['t2', 'Benjamín'], '2025-09-15'),
        ],
      },
    });
    const r = await getClubStaffFromClient(sb, CLUB);
    expect(r.map((c) => c.fullName)).toEqual(['Ana Díaz', 'Zoe Vega']);
    // Ana agrupa 2 asignaciones, ordenadas por joined_at desc.
    expect(r[0]!.assignments.map((a) => a.teamName)).toEqual(['Benjamín', 'Alevín A']);
  });

  it('excluye staff de OTRO club', async () => {
    const sb = makeClient({
      team_staff: {
        data: [
          staffRow('s1', 'm1', 'Ana Díaz', 'entrenador_principal', ['t1', 'Alevín A'], '2025-09-01'),
          staffRow('sX', 'mX', 'Otro Club', 'entrenador_principal', ['tX', 'Ext'], '2025-09-01', OTHER),
        ],
      },
    });
    const r = await getClubStaffFromClient(sb, CLUB);
    expect(r.map((c) => c.membershipId)).toEqual(['m1']);
  });

  it('excluye roles que no son de entrenador (coordinador/admin)', async () => {
    const sb = makeClient({
      team_staff: {
        data: [
          staffRow('s1', 'm1', 'Ana Díaz', 'entrenador_principal', ['t1', 'Alevín A'], '2025-09-01'),
          staffRow('s2', 'm9', 'Coord', 'coordinador', ['t1', 'Alevín A'], '2025-09-01'),
        ],
      },
    });
    const r = await getClubStaffFromClient(sb, CLUB);
    expect(r.map((c) => c.membershipId)).toEqual(['m1']);
  });

  it('sin cuerpo técnico → lista vacía', async () => {
    const sb = makeClient({ team_staff: { data: [] } });
    expect(await getClubStaffFromClient(sb, CLUB)).toEqual([]);
  });
});
