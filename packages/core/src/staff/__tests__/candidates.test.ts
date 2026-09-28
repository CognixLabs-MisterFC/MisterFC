import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  getCoordinatedTeamIdsFromClient,
  getStaffCandidatesFromClient,
} from '../candidates';
import { canAssignStaffToTeam } from '../assignment-targets';

/**
 * W-3 — añadir staff a un equipo: a QUIÉN se ofrece y si sale el botón.
 *
 * Esta consulta estaba a mano en `equipos/[teamId]/page.tsx`, donde no la probaba
 * nadie (`apps/web` no tiene runner). Al bajarla se vigila lo que de verdad puede
 * salir mal: que no se ofrezca a un jugador, que sí se ofrezca a quien no tiene
 * ningún equipo, y que un fallo de lectura no se convierta en "ofrécelo todo".
 */
type Miembro = { id: string; role: string; nombre: string | null; club: string };

function cliente(opts: {
  miembros?: Miembro[];
  staff?: { team_id: string; staff_role: string; membership_id: string }[];
  errorMiembros?: { code: string } | null;
  errorStaff?: { code: string } | null;
}): { db: SupabaseClient<Database>; tablas: string[] } {
  const tablas: string[] = [];

  const from = (tabla: string) => {
    tablas.push(tabla);
    const f: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      f[col] = val;
      return b;
    };
    b.is = (col: string, val: unknown) => {
      f[col] = val;
      return b;
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (tabla === 'memberships') {
        if (opts.errorMiembros) {
          return Promise.resolve({ data: null, error: opts.errorMiembros }).then(resolve);
        }
        return Promise.resolve({
          data: (opts.miembros ?? [])
            .filter((m) => m.club === f['club_id'])
            .map((m) => ({ id: m.id, role: m.role, profiles: { full_name: m.nombre } })),
          error: null,
        }).then(resolve);
      }
      if (tabla === 'team_staff') {
        if (opts.errorStaff) {
          return Promise.resolve({ data: null, error: opts.errorStaff }).then(resolve);
        }
        return Promise.resolve({
          data: (opts.staff ?? []).filter(
            (s) =>
              s.membership_id === f['membership_id'] && s.staff_role === f['staff_role'],
          ),
          error: null,
        }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient<Database>, tablas };
}

const CLUB = 'club-1';

describe('getStaffCandidatesFromClient · a quién se puede añadir', () => {
  it('ofrece a los cinco roles de staff y NO a los jugadores', async () => {
    const { db } = cliente({
      miembros: [
        { id: 'm1', role: 'admin_club', nombre: 'Ana', club: CLUB },
        { id: 'm2', role: 'director', nombre: 'Bruno', club: CLUB },
        { id: 'm3', role: 'coordinador', nombre: 'Carla', club: CLUB },
        { id: 'm4', role: 'entrenador_principal', nombre: 'Diego', club: CLUB },
        { id: 'm5', role: 'entrenador_ayudante', nombre: 'Elena', club: CLUB },
        { id: 'm6', role: 'jugador', nombre: 'Fran', club: CLUB },
      ],
    });
    const res = await getStaffCandidatesFromClient(db, CLUB);
    expect(res.map((c) => c.membershipId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    // El jugador no sale: darle una función de staff es otro flujo.
    expect(res.map((c) => c.clubRole)).not.toContain('jugador');
  });

  it('SÍ ofrece a quien no tiene ningún equipo', async () => {
    // Es el caso que justifica esta lectura: `getClubStaffFromClient` arranca desde
    // team_staff y a esta persona no la vería nunca.
    const { db, tablas } = cliente({
      miembros: [{ id: 'm9', role: 'entrenador_ayudante', nombre: 'Sin equipo', club: CLUB }],
      staff: [],
    });
    const res = await getStaffCandidatesFromClient(db, CLUB);
    expect(res.map((c) => c.membershipId)).toEqual(['m9']);
    // Y se lee de `memberships`, no de `team_staff`.
    expect(tablas).toEqual(['memberships']);
  });

  it('no ofrece a miembros de otro club', async () => {
    const { db } = cliente({
      miembros: [
        { id: 'm1', role: 'director', nombre: 'Ana', club: CLUB },
        { id: 'x1', role: 'director', nombre: 'Ajeno', club: 'club-2' },
      ],
    });
    const res = await getStaffCandidatesFromClient(db, CLUB);
    expect(res.map((c) => c.membershipId)).toEqual(['m1']);
  });

  it('ordena por nombre sin distinguir acentos ni mayúsculas', async () => {
    const { db } = cliente({
      miembros: [
        { id: 'm1', role: 'director', nombre: 'Zoe', club: CLUB },
        { id: 'm2', role: 'director', nombre: 'Ángel', club: CLUB },
        { id: 'm3', role: 'director', nombre: 'ana', club: CLUB },
      ],
    });
    const res = await getStaffCandidatesFromClient(db, CLUB);
    expect(res.map((c) => c.fullName)).toEqual(['ana', 'Ángel', 'Zoe']);
  });

  it('un nombre vacío no revienta la lista ni el orden', async () => {
    const { db } = cliente({
      miembros: [
        { id: 'm1', role: 'director', nombre: null, club: CLUB },
        { id: 'm2', role: 'director', nombre: 'Ana', club: CLUB },
      ],
    });
    const res = await getStaffCandidatesFromClient(db, CLUB);
    expect(res).toHaveLength(2);
    expect(res.find((c) => c.membershipId === 'm1')?.fullName).toBe('—');
  });

  it('si la lectura falla, lista vacía y se avisa', async () => {
    const { db } = cliente({ errorMiembros: { code: '42501' } });
    const vistos: unknown[] = [];
    const res = await getStaffCandidatesFromClient(db, CLUB, (e) => vistos.push(e));
    expect(res).toEqual([]);
    expect(vistos).toHaveLength(1);
  });
});

describe('getCoordinatedTeamIdsFromClient · null no es "ninguno"', () => {
  it('a admin_club y director devuelve null, y no consulta nada', async () => {
    for (const role of ['admin_club', 'director'] as const) {
      const { db, tablas } = cliente({ staff: [{ team_id: 't1', staff_role: 'coordinador', membership_id: 'm1' }] });
      expect(await getCoordinatedTeamIdsFromClient(db, { membershipId: 'm1', role })).toBeNull();
      expect(tablas).toEqual([]);
    }
  });

  it('al coordinador, los equipos donde su función ES coordinador', async () => {
    const { db } = cliente({
      staff: [
        { team_id: 't1', staff_role: 'coordinador', membership_id: 'm1' },
        { team_id: 't2', staff_role: 'entrenador_ayudante', membership_id: 'm1' },
        { team_id: 't3', staff_role: 'coordinador', membership_id: 'otro' },
      ],
    });
    const res = await getCoordinatedTeamIdsFromClient(db, {
      membershipId: 'm1',
      role: 'coordinador',
    });
    expect(res).toEqual(['t1']);
  });

  it('si falla la lectura devuelve [] y NO null', async () => {
    // null significa "no hace falta recortar": devolverlo ante un fallo le abriría
    // el club entero. Esta es la diferencia que importa de toda la función.
    const { db } = cliente({ errorStaff: { code: '42501' } });
    const vistos: unknown[] = [];
    const res = await getCoordinatedTeamIdsFromClient(
      db,
      { membershipId: 'm1', role: 'coordinador' },
      (e) => vistos.push(e),
    );
    expect(res).toEqual([]);
    expect(res).not.toBeNull();
    expect(vistos).toHaveLength(1);
  });
});

describe('canAssignStaffToTeam · si sale el botón en la ficha del equipo', () => {
  it('admin_club y director, en cualquier equipo', () => {
    for (const role of ['admin_club', 'director'] as const) {
      expect(canAssignStaffToTeam(role, 't-cualquiera', null)).toBe(true);
    }
  });

  it('el coordinador SOLO en los equipos que coordina', () => {
    expect(canAssignStaffToTeam('coordinador', 't1', ['t1'])).toBe(true);
    // Éste es el 42501 que la web servía en bandeja: es staff del equipo, pero no
    // lo coordina.
    expect(canAssignStaffToTeam('coordinador', 't2', ['t1'])).toBe(false);
  });

  it('coordinador sin nada coordinado: en ninguno', () => {
    expect(canAssignStaffToTeam('coordinador', 't1', [])).toBe(false);
  });

  it('coordinador con null: en ninguno (falla cerrado)', () => {
    expect(canAssignStaffToTeam('coordinador', 't1', null)).toBe(false);
  });

  it('principal, ayudante, jugador y sin rol: nunca', () => {
    for (const role of ['entrenador_principal', 'entrenador_ayudante', 'jugador'] as const) {
      expect(canAssignStaffToTeam(role, 't1', ['t1'])).toBe(false);
    }
    expect(canAssignStaffToTeam(null, 't1', ['t1'])).toBe(false);
  });
});
