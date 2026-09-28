import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  PLAYER_LINK_RELATIONS,
  canLinkPlayers,
  getMemberPlayerLinksFromClient,
  linkPlayerToMember,
} from '../player-links';
import { canAssignStaffToTeam } from '../assignment-targets';
import { canEditStaffIdentity } from '../identity';

/**
 * W-5 — vincular un jugador a un miembro del club.
 *
 * Las tres reglas que se prueban aquí vivían en `apps/web`, que no tiene runner:
 * quién puede vincular, a quién se le puede vincular y qué significa cada fallo del
 * INSERT. Lo que se vigila es lo que de verdad puede salir mal: que no se ofrezca a
 * quien ya está vinculado ni a una baja del club, que un `self` no se pueda escribir,
 * y que los dos códigos de Postgres no se conviertan en 'generic'.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

type Jugador = {
  id: string;
  first_name: string;
  last_name: string | null;
  club_id: string;
  erased_at?: string | null;
  left_club_at?: string | null;
};
type Vinculo = { id: string; player_id: string; profile_id: string; relation: string };

function cliente(opts: {
  jugadores?: Jugador[];
  vinculos?: Vinculo[];
  membresias?: { id: string; profile_id: string; club_id: string }[];
  errorVinculos?: { code: string } | null;
  errorJugadores?: { code: string } | null;
  errorInsert?: { code?: string } | null;
}): {
  db: SupabaseClient<Database>;
  insertado: Record<string, unknown>[];
  tablas: string[];
} {
  const insertado: Record<string, unknown>[] = [];
  const tablas: string[] = [];

  const from = (tabla: string) => {
    tablas.push(tabla);
    const f: Record<string, unknown> = {};
    // Qué columnas se han restringido DE VERDAD. Sin esto, el doble aplicaba el
    // filtro de `erased_at` aunque la consulta no lo pidiera —`undefined ?? null`
    // coincide con `null`— y el control negativo CN7 no mordía: el test decía
    // proteger la exclusión de suprimidos y bajas, y lo que medía era el doble.
    const puestos = new Set<string>();
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      f[col] = val;
      puestos.add(col);
      return b;
    };
    b.is = (col: string, val: unknown) => {
      f[col] = val;
      puestos.add(col);
      return b;
    };
    b.insert = (fila: Record<string, unknown>) => {
      insertado.push(fila);
      return Promise.resolve({ error: opts.errorInsert ?? null });
    };
    b.maybeSingle = () => {
      if (tabla === 'memberships') {
        const m = (opts.membresias ?? []).find((x) => x.id === f['id']) ?? null;
        return Promise.resolve({ data: m, error: null });
      }
      if (tabla === 'players') {
        const p = (opts.jugadores ?? []).find((x) => x.id === f['id']) ?? null;
        return Promise.resolve({ data: p, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (tabla === 'player_accounts') {
        if (opts.errorVinculos) {
          return Promise.resolve({ data: null, error: opts.errorVinculos }).then(resolve);
        }
        const filas = (opts.vinculos ?? [])
          .filter((v) => v.profile_id === f['profile_id'])
          .map((v) => {
            const p = (opts.jugadores ?? []).find((x) => x.id === v.player_id);
            return {
              id: v.id,
              player_id: v.player_id,
              relation: v.relation,
              players: p
                ? {
                    id: p.id,
                    first_name: p.first_name,
                    last_name: p.last_name,
                    club_id: p.club_id,
                  }
                : null,
            };
          })
          .filter((r) => r.players != null);
        return Promise.resolve({ data: filas, error: null }).then(resolve);
      }
      if (tabla === 'players') {
        if (opts.errorJugadores) {
          return Promise.resolve({ data: null, error: opts.errorJugadores }).then(resolve);
        }
        const filas = (opts.jugadores ?? [])
          .filter((p) => !puestos.has('club_id') || p.club_id === f['club_id'])
          .filter((p) => !puestos.has('erased_at') || (p.erased_at ?? null) === null)
          .filter(
            (p) => !puestos.has('left_club_at') || (p.left_club_at ?? null) === null,
          )
          .map((p) => ({
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
          }));
        return Promise.resolve({ data: filas, error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };
    return b;
  };

  return { db: { from } as unknown as SupabaseClient<Database>, insertado, tablas };
}

describe('canLinkPlayers', () => {
  it('admin_club y director vinculan', () => {
    expect(canLinkPlayers('admin_club')).toBe(true);
    expect(canLinkPlayers('director')).toBe(true);
  });

  it('el coordinador NO, aunque la policy le deje con SUS jugadores', () => {
    // No es un descuido: `players_select_member` le deja leer el club entero, así que
    // su lista de candidatos no viene recortada y casi todo le daría 42501.
    expect(canLinkPlayers('coordinador')).toBe(false);
  });

  it('los entrenadores y el jugador tampoco', () => {
    expect(canLinkPlayers('entrenador_principal')).toBe(false);
    expect(canLinkPlayers('entrenador_ayudante')).toBe(false);
    expect(canLinkPlayers('jugador')).toBe(false);
  });

  it('sin rol no vincula (falla cerrado)', () => {
    expect(canLinkPlayers(null)).toBe(false);
    expect(canLinkPlayers(undefined)).toBe(false);
  });

  it('NO es el permiso de asignar equipos: el coordinador entra en aquél y no en éste', () => {
    // El atajo tentador es reutilizar uno de los otros dos permisos de la serie.
    // Este test es el que se cae si alguien lo hace.
    const equipo = '44444444-4444-4444-8444-444444444444';
    expect(canAssignStaffToTeam('coordinador', equipo, [equipo])).toBe(true);
    expect(canLinkPlayers('coordinador')).toBe(false);
  });

  it('coincide HOY con el de editar identidad, y son decisiones distintas', () => {
    // Coinciden en los cinco roles, y aun así no se reutiliza: una la impone una
    // policy de tabla y la otra dos RPC. Este test documenta la coincidencia para que
    // el día que una cambie, se vea que la otra no tiene por qué.
    for (const r of [
      'admin_club',
      'director',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
    ] as const) {
      expect(canLinkPlayers(r)).toBe(canEditStaffIdentity(r));
    }
  });
});

describe('PLAYER_LINK_RELATIONS', () => {
  it('se ofrecen dos, y `self` NO es una de ellas', () => {
    expect([...PLAYER_LINK_RELATIONS]).toEqual(['parent', 'guardian']);
    expect((PLAYER_LINK_RELATIONS as readonly string[]).includes('self')).toBe(false);
  });
});

describe('getMemberPlayerLinksFromClient', () => {
  const club = 'club-1';
  const perfil = 'perfil-1';

  it('lista lo vinculado y ofrece el resto del club', async () => {
    const { db } = cliente({
      jugadores: [
        { id: P1, first_name: 'Ana', last_name: 'Ruiz', club_id: club },
        { id: P2, first_name: 'Bruno', last_name: 'Diaz', club_id: club },
      ],
      vinculos: [{ id: 'v1', player_id: P1, profile_id: perfil, relation: 'parent' }],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.linked.map((l) => l.playerId)).toEqual([P1]);
    expect(res.linked[0]?.relation).toBe('parent');
    expect(res.candidates.map((c) => c.playerId)).toEqual([P2]);
  });

  it('no ofrece a quien YA está vinculado a esta persona', async () => {
    const { db } = cliente({
      jugadores: [{ id: P1, first_name: 'Ana', last_name: null, club_id: club }],
      vinculos: [{ id: 'v1', player_id: P1, profile_id: perfil, relation: 'guardian' }],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.candidates).toEqual([]);
  });

  it('SÍ ofrece a quien está vinculado a OTRA persona (varios tutores es normal)', async () => {
    const { db } = cliente({
      jugadores: [{ id: P1, first_name: 'Ana', last_name: null, club_id: club }],
      vinculos: [{ id: 'v1', player_id: P1, profile_id: 'otro-perfil', relation: 'parent' }],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.linked).toEqual([]);
    expect(res.candidates.map((c) => c.playerId)).toEqual([P1]);
  });

  it('no ofrece a los suprimidos por RGPD ni a las bajas del club', async () => {
    const { db } = cliente({
      jugadores: [
        { id: P1, first_name: 'Ana', last_name: null, club_id: club, erased_at: '2026-01-01' },
        { id: P2, first_name: 'Bruno', last_name: null, club_id: club, left_club_at: '2026-01-01' },
        { id: P3, first_name: 'Carla', last_name: null, club_id: club },
      ],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.candidates.map((c) => c.playerId)).toEqual([P3]);
  });

  it('no ofrece jugadores de otro club', async () => {
    const { db } = cliente({
      jugadores: [{ id: P1, first_name: 'Ana', last_name: null, club_id: 'club-2' }],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.candidates).toEqual([]);
  });

  it('un vínculo de otro club no se cuela en la lista', async () => {
    const { db } = cliente({
      jugadores: [{ id: P1, first_name: 'Ana', last_name: null, club_id: 'club-2' }],
      vinculos: [{ id: 'v1', player_id: P1, profile_id: perfil, relation: 'parent' }],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.linked).toEqual([]);
  });

  it('una fila `self` se LEE (el miembro es además jugador con cuenta propia)', async () => {
    const { db } = cliente({
      jugadores: [{ id: P1, first_name: 'Ana', last_name: 'Ruiz', club_id: club }],
      vinculos: [{ id: 'v1', player_id: P1, profile_id: perfil, relation: 'self' }],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.linked[0]?.relation).toBe('self');
  });

  it('una relación que no existe se descarta en vez de pintarse en crudo', async () => {
    const { db } = cliente({
      jugadores: [{ id: P1, first_name: 'Ana', last_name: null, club_id: club }],
      vinculos: [{ id: 'v1', player_id: P1, profile_id: perfil, relation: 'abuela' }],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.linked).toEqual([]);
  });

  it('ordena las dos listas por nombre en español', async () => {
    const { db } = cliente({
      jugadores: [
        { id: P1, first_name: 'Zoe', last_name: null, club_id: club },
        { id: P2, first_name: 'Ana', last_name: null, club_id: club },
        { id: P3, first_name: 'Ángel', last_name: null, club_id: club },
      ],
    });
    const res = await getMemberPlayerLinksFromClient(db, { clubId: club, profileId: perfil });
    expect(res.candidates.map((c) => c.fullName)).toEqual(['Ana', 'Ángel', 'Zoe']);
  });

  it('un fallo al leer avisa y no se disfraza de "no hay nada que ofrecer"', async () => {
    const vistos: unknown[] = [];
    const { db } = cliente({ errorVinculos: { code: '42501' }, errorJugadores: { code: '42501' } });
    const res = await getMemberPlayerLinksFromClient(
      db,
      { clubId: club, profileId: perfil },
      (e) => vistos.push(e),
    );
    expect(vistos).toHaveLength(2);
    expect(res.linked).toEqual([]);
    expect(res.candidates).toEqual([]);
  });
});

describe('linkPlayerToMember', () => {
  const club = 'club-1';
  const membresia = 'mem-1';
  const base = {
    membresias: [{ id: membresia, profile_id: 'perfil-1', club_id: club }],
    jugadores: [{ id: P1, first_name: 'Ana', last_name: null, club_id: club }],
  };

  it('escribe el vínculo con el PERFIL de la membresía, no con la membresía', async () => {
    const { db, insertado } = cliente(base);
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P1,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: true });
    expect(insertado).toEqual([
      { player_id: P1, profile_id: 'perfil-1', relation: 'parent' },
    ]);
  });

  it('acepta guardian', async () => {
    const { db, insertado } = cliente(base);
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P1,
      relation: 'guardian',
    });
    expect(res).toEqual({ ok: true });
    expect(insertado[0]?.relation).toBe('guardian');
  });

  it('NO acepta `self`, y no llega a escribir', async () => {
    const { db, insertado } = cliente(base);
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P1,
      relation: 'self',
    });
    expect(res).toEqual({ ok: false, error: 'relation_invalid' });
    expect(insertado).toEqual([]);
  });

  it('una relación inventada tampoco escribe', async () => {
    const { db, insertado } = cliente(base);
    for (const r of ['abuela', '', null, undefined, 42]) {
      const res = await linkPlayerToMember(db, {
        membershipId: membresia,
        playerId: P1,
        relation: r,
      });
      expect(res).toEqual({ ok: false, error: 'relation_invalid' });
    }
    expect(insertado).toEqual([]);
  });

  it('un id de jugador que no es UUID se corta antes de consultar', async () => {
    const { db, tablas } = cliente(base);
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: 'no-soy-un-uuid',
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'player_invalid' });
    expect(tablas).toEqual([]);
  });

  it('con los dos campos mal, tampoco escribe', async () => {
    const { db, insertado } = cliente(base);
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: 'malo',
      relation: 'abuela',
    });
    expect(res.ok).toBe(false);
    expect(insertado).toEqual([]);
  });

  it('una membresía que no se ve da forbidden, no "no existe"', async () => {
    const { db } = cliente(base);
    const res = await linkPlayerToMember(db, {
      membershipId: 'mem-que-no-veo',
      playerId: P1,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('un jugador que no existe da player_invalid', async () => {
    const { db } = cliente(base);
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P2,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'player_invalid' });
  });

  it('un jugador de otro club da cross_club y no se escribe', async () => {
    const { db, insertado } = cliente({
      membresias: base.membresias,
      jugadores: [{ id: P2, first_name: 'Bruno', last_name: null, club_id: 'club-2' }],
    });
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P2,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'cross_club' });
    expect(insertado).toEqual([]);
  });

  it('42501 es forbidden: lo decide la RLS, no esto', async () => {
    const { db } = cliente({ ...base, errorInsert: { code: '42501' } });
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P1,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('23505 es already_linked (el UNIQUE player+perfil)', async () => {
    const { db } = cliente({ ...base, errorInsert: { code: '23505' } });
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P1,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'already_linked' });
  });

  it('cualquier otro error es generic, no un desenlace con nombre', async () => {
    const { db } = cliente({ ...base, errorInsert: { code: '23514' } });
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P1,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'generic' });
  });

  it('un error sin código tampoco se da por bueno', async () => {
    const { db } = cliente({ ...base, errorInsert: { message: 'algo' } as { code?: string } });
    const res = await linkPlayerToMember(db, {
      membershipId: membresia,
      playerId: P1,
      relation: 'parent',
    });
    expect(res).toEqual({ ok: false, error: 'generic' });
  });
});
