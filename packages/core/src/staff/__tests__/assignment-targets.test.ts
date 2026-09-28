import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  assignmentTargetTeamIds,
  getAssignmentTargetTeamsFromClient,
} from '../assignment-targets';

/**
 * W-2 — los equipos que se OFRECEN como destino al agregar un rol.
 *
 * Lo que se vigila aquí es que la oferta no se pase de generosa ni se quede corta:
 *   · el director ve todo el club; el coordinador, solo lo que coordina (que es lo
 *     que la RLS `team_staff_insert_admin` le va a aceptar, vía
 *     `user_coordinates_team`);
 *   · el recorte del coordinador mira `staff_role = 'coordinador'`, NO "ser staff";
 *   · la intersección se hace contra los equipos de la TEMPORADA ACTIVA, para que una
 *     fila viva del año pasado no se cuele como destino;
 *   · y si la lectura de lo que coordina falla, no se ofrece nada — el fallo no puede
 *     degenerar en "ofrécele el club entero".
 */
type Fila = { team_id: string; staff_role: string };

function cliente(opts: {
  equipos?: { id: string; name: string; season: string }[];
  staff?: Fila[];
  staffError?: { code: string } | null;
}): { db: SupabaseClient<Database>; tablas: string[] } {
  const tablas: string[] = [];
  const equipos = opts.equipos ?? [];

  const from = (tabla: string) => {
    tablas.push(tabla);
    const filtros: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filtros[col] = val;
      return b;
    };
    b.is = () => b;
    b.order = () => b;
    // El final de la cadena se espera con `await`: el builder es thenable.
    b.then = (resolve: (v: unknown) => unknown) => {
      if (tabla === 'seasons') {
        return Promise.resolve({ data: [{ label: '2026/27', status: 'active' }] }).then(resolve);
      }
      if (tabla === 'teams') {
        const season = filtros['season'];
        return Promise.resolve({
          data: equipos
            .filter((t) => t.season === season)
            .map((t) => ({
              id: t.id,
              name: t.name,
              color: '#000',
              format: 'f11',
              season: t.season,
              categories: { club_id: 'club-1', name: 'Cat' },
            })),
        }).then(resolve);
      }
      if (tabla === 'team_staff') {
        if (opts.staffError) {
          return Promise.resolve({ data: null, error: opts.staffError }).then(resolve);
        }
        const rol = filtros['staff_role'];
        return Promise.resolve({
          data: (opts.staff ?? []).filter((f) => f.staff_role === rol),
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
const TRES = [
  { id: 't1', name: 'Infantil A', season: '2026/27' },
  { id: 't2', name: 'Cadete B', season: '2026/27' },
  { id: 't3', name: 'Alevín C', season: '2026/27' },
];

describe('getAssignmentTargetTeamsFromClient · a qué equipos', () => {
  it('al director, todos los equipos del club', async () => {
    const { db } = cliente({ equipos: TRES });
    const res = await getAssignmentTargetTeamsFromClient(db, {
      clubId: CLUB,
      viewerMembershipId: 'm1',
      role: 'director',
    });
    expect(res.map((t) => t.teamId).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('al director no se le pregunta qué coordina: no hace falta', async () => {
    const { db, tablas } = cliente({ equipos: TRES });
    await getAssignmentTargetTeamsFromClient(db, {
      clubId: CLUB,
      viewerMembershipId: 'm1',
      role: 'director',
    });
    expect(tablas).not.toContain('team_staff');
  });

  it('al coordinador, SOLO los que coordina', async () => {
    const { db } = cliente({
      equipos: TRES,
      staff: [
        { team_id: 't1', staff_role: 'coordinador' },
        // Es ayudante en otro: la web se lo ofrecería, la RLS lo rechaza.
        { team_id: 't2', staff_role: 'entrenador_ayudante' },
      ],
    });
    const res = await getAssignmentTargetTeamsFromClient(db, {
      clubId: CLUB,
      viewerMembershipId: 'm1',
      role: 'coordinador',
    });
    expect(res.map((t) => t.teamId)).toEqual(['t1']);
  });

  it('un equipo que coordina en la temporada PASADA no es destino', async () => {
    const { db } = cliente({
      equipos: [
        { id: 't1', name: 'Infantil A', season: '2026/27' },
        { id: 't-viejo', name: 'Infantil A', season: '2025/26' },
      ],
      staff: [
        { team_id: 't1', staff_role: 'coordinador' },
        { team_id: 't-viejo', staff_role: 'coordinador' },
      ],
    });
    const res = await getAssignmentTargetTeamsFromClient(db, {
      clubId: CLUB,
      viewerMembershipId: 'm1',
      role: 'coordinador',
    });
    expect(res.map((t) => t.teamId)).toEqual(['t1']);
  });

  it('coordinador sin equipos coordinados: lista vacía, no el club entero', async () => {
    const { db } = cliente({
      equipos: TRES,
      staff: [{ team_id: 't2', staff_role: 'entrenador_principal' }],
    });
    const res = await getAssignmentTargetTeamsFromClient(db, {
      clubId: CLUB,
      viewerMembershipId: 'm1',
      role: 'coordinador',
    });
    expect(res).toEqual([]);
  });

  it('si falla la lectura de lo que coordina, no se ofrece nada y se avisa', async () => {
    const { db } = cliente({ equipos: TRES, staffError: { code: '42501' } });
    const vistos: unknown[] = [];
    const res = await getAssignmentTargetTeamsFromClient(
      db,
      { clubId: CLUB, viewerMembershipId: 'm1', role: 'coordinador' },
      (e) => vistos.push(e),
    );
    expect(res).toEqual([]);
    expect(vistos).toHaveLength(1);
  });

  it('a quien no agrega roles no se le lee NADA', async () => {
    for (const role of ['entrenador_principal', 'entrenador_ayudante', 'jugador'] as const) {
      const { db, tablas } = cliente({ equipos: TRES });
      const res = await getAssignmentTargetTeamsFromClient(db, {
        clubId: CLUB,
        viewerMembershipId: 'm1',
        role,
      });
      expect(res).toEqual([]);
      // Ni una consulta: la política corta antes de tocar la base.
      expect(tablas).toEqual([]);
    }
  });

  it('sin rol resuelto todavía, tampoco', async () => {
    const { db, tablas } = cliente({ equipos: TRES });
    expect(
      await getAssignmentTargetTeamsFromClient(db, {
        clubId: CLUB,
        viewerMembershipId: 'm1',
        role: null,
      }),
    ).toEqual([]);
    expect(tablas).toEqual([]);
  });
});

/**
 * W-2b — el recorte puro, que es el que comparten la web y la app.
 *
 * Lo que se vigila: que el conjunto ofrecido sea el que la RLS acepta, y que los
 * casos raros fallen CERRADOS. Antes de W-2b las dos pantallas de la web ofrecían
 * al coordinador todos los equipos donde era staff de cualquier función, y el
 * INSERT los rechazaba con 42501.
 */
describe('assignmentTargetTeamIds · el recorte puro', () => {
  const VISIBLES = ['t1', 't2', 't3'];

  it('admin_club y director: los visibles, tal cual', () => {
    for (const role of ['admin_club', 'director'] as const) {
      expect(assignmentTargetTeamIds(role, VISIBLES, null)).toEqual(VISIBLES);
    }
  });

  it('a admin/director no le afecta traer lista de coordinados', () => {
    // Un director puede coordinar un equipo además de dirigir; eso NO le recorta.
    expect(assignmentTargetTeamIds('director', VISIBLES, ['t2'])).toEqual(VISIBLES);
  });

  it('coordinador: solo la intersección con lo que coordina', () => {
    expect(assignmentTargetTeamIds('coordinador', VISIBLES, ['t2', 't9'])).toEqual(['t2']);
  });

  it('coordinador: un equipo que coordina pero no es visible no se cuela', () => {
    // 't9' está en su lista de coordinados pero no en los visibles (p. ej. otra
    // temporada). La intersección manda.
    expect(assignmentTargetTeamIds('coordinador', VISIBLES, ['t9'])).toEqual([]);
  });

  it('coordinador con la lista de coordinados en null: NADA (falla cerrado)', () => {
    // null significa "no aplica" para admin/director. Si llega null siendo
    // coordinador es que no se ha podido resolver, y entonces no se ofrece nada.
    // Lo contrario —devolver los visibles— es exactamente el fallo de W-2b.
    expect(assignmentTargetTeamIds('coordinador', VISIBLES, null)).toEqual([]);
  });

  it('coordinador sin nada coordinado: lista vacía', () => {
    expect(assignmentTargetTeamIds('coordinador', VISIBLES, [])).toEqual([]);
  });

  it('quien no agrega roles: vacío, aunque le pasen equipos y coordinados', () => {
    for (const role of ['entrenador_principal', 'entrenador_ayudante', 'jugador'] as const) {
      expect(assignmentTargetTeamIds(role, VISIBLES, ['t1'])).toEqual([]);
    }
    expect(assignmentTargetTeamIds(null, VISIBLES, ['t1'])).toEqual([]);
  });

  it('no reordena ni duplica: conserva el orden de los visibles', () => {
    expect(assignmentTargetTeamIds('coordinador', ['t3', 't1'], ['t1', 't3'])).toEqual([
      't3',
      't1',
    ]);
  });
});
