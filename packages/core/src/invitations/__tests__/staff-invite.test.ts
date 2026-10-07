import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  canInviteToClub,
  invitableRoles,
  isHighClubRole,
  matchPendingByEmail,
  performStaffInvite,
  type InvitableRole,
} from '../staff-invite';

/**
 * W-6 — invitar a alguien que NO está en el club.
 *
 * Estas reglas vivían en una Server Action de 763 líneas que ningún test ejecutaba, y
 * cada rama de ella se pagó con un incidente: la cuenta sin enlazar que pedía una
 * contraseña que nadie fijó, el segundo correo a la misma persona, el `player_id`
 * pisado que rompía el vínculo familiar.
 *
 * Lo que más se vigila aquí no es un valor de vuelta: es el ORDEN. La fila de
 * invitación se escribe con el cliente del USUARIO —ahí está el gate, la RLS
 * `invitations_insert_admin`— y el admin no puede aparecer antes. Si alguien lo
 * adelanta, nada falla: la invitación se crea igual, sin permiso. De eso hay test.
 */

const CLUB = 'club-1';
const ACTOR = 'perfil-actor';
const LINK_BASE = 'https://misterfc.es/es/invite';

/**
 * Una pendiente del club. `playerId` importa: el circuito de TUTOR escribe en esta
 * MISMA tabla con `role='jugador'` y un `player_id`, y esas filas NO se renuevan.
 */
type Pendiente = { id: string; email: string; role: string; playerId?: string | null };

type UserOpts = {
  membresias?: { id: string; club_id: string; role: string }[] | null;
  errorMembresias?: { code?: string; message?: string } | null;
  owner?: string | null;
  /** Filas de `club_member_by_email`. */
  miembro?: { membership_id: string; full_name: string | null; role: string }[];
  errorMiembro?: { message: string } | null;
  pendientes?: Pendiente[];
  errorPendientes?: { code?: string; message?: string } | null;
  /** Filas de `club_pending_invitation_by_email` (incluye las de jugador). */
  pendientesDelCorreo?: { invitation_id: string }[];
  errorPendientesRpc?: { message: string } | null;
  errorInsert?: { code?: string; message?: string } | null;
  errorUpdate?: { code?: string; message?: string } | null;
  /** `is_superadmin()`: el escape del superadmin en un club donde NO es miembro. */
  esSuperadmin?: boolean;
  /** Se anota cada paso, EN ORDEN, para poder afirmar el orden del candado. */
  traza?: string[];
};

function clienteUsuario(opts: UserOpts): SupabaseClient<Database> {
  const traza = opts.traza ?? [];
  const from = (tabla: string) => {
    const b: Record<string, unknown> = {};
    const enc: Record<string, unknown> = {};
    const restringidas = new Set<string>();
    b.select = () => b;
    b.eq = (c: string, v: unknown) => {
      enc[c] = v;
      return b;
    };
    // Qué columnas se restringen DE VERDAD. Sin esto el doble ignoraba los `.is()`,
    // así que quitar `player_id is null` del alcance no movía ningún test: el control
    // negativo CN16 no mordía y el test decía proteger algo que no medía. Mismo fallo
    // que en W-5, misma cura.
    b.is = (c: string, v: unknown) => {
      enc[c] = v;
      restringidas.add(c);
      return b;
    };
    b.gt = () => b;
    b.order = () => b;
    b.single = async () => {
      if (tabla === 'clubs') {
        traza.push('read:clubs');
        return { data: { owner_profile_id: opts.owner ?? null }, error: null };
      }
      return { data: null, error: null };
    };
    b.insert = (fila: Record<string, unknown>) => {
      traza.push('write:invitations:insert');
      return {
        select: () => ({
          single: async () =>
            opts.errorInsert
              ? { data: null, error: opts.errorInsert }
              : { data: { id: 'inv-nueva', token: 'tok-nuevo', ...fila }, error: null },
        }),
      };
    };
    b.update = (patch: Record<string, unknown>) => {
      traza.push('write:invitations:update');
      return {
        eq: (_c: string, id: unknown) => ({
          select: () => ({
            single: async () =>
              opts.errorUpdate
                ? { data: null, error: opts.errorUpdate }
                : {
                    data: { id, token: patch['token'], ...patch },
                    error: null,
                  },
          }),
        }),
      };
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (tabla === 'memberships') {
        traza.push('read:memberships');
        if (opts.errorMembresias) {
          return Promise.resolve({ data: null, error: opts.errorMembresias }).then(resolve);
        }
        return Promise.resolve({ data: opts.membresias ?? [], error: null }).then(resolve);
      }
      if (tabla === 'invitations') {
        traza.push('read:invitations');
        if (opts.errorPendientes) {
          return Promise.resolve({ data: null, error: opts.errorPendientes }).then(resolve);
        }
        const dentro = (opts.pendientes ?? []).filter(
          (p) => !restringidas.has('player_id') || (p.playerId ?? null) === null,
        );
        return Promise.resolve({ data: dentro, error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };
    return b;
  };

  const rpc = async (nombre: string) => {
    traza.push(`rpc:${nombre}`);
    if (nombre === 'club_member_by_email') {
      return opts.errorMiembro
        ? { data: null, error: opts.errorMiembro }
        : { data: opts.miembro ?? [], error: null };
    }
    if (nombre === 'is_superadmin') {
      return { data: opts.esSuperadmin === true, error: null };
    }
    if (nombre === 'club_pending_invitation_by_email') {
      return opts.errorPendientesRpc
        ? { data: null, error: opts.errorPendientesRpc }
        : { data: opts.pendientesDelCorreo ?? [], error: null };
    }
    return { data: null, error: null };
  };

  return { from, rpc } as unknown as SupabaseClient<Database>;
}

type AdminOpts = {
  createError?: { message?: string; code?: string; status?: number } | null;
  invitedUserId?: string | null;
  traza?: string[];
};

function clienteAdmin(opts: AdminOpts): SupabaseClient<Database> {
  const traza = opts.traza ?? [];
  const uid = opts.invitedUserId === undefined ? 'auth-1' : opts.invitedUserId;
  return {
    auth: {
      admin: {
        createUser: async (attrs: unknown) => {
          traza.push('admin:createUser');
          (clienteAdmin as unknown as { ultimo?: unknown }).ultimo = attrs;
          return {
            data: uid ? { user: { id: uid } } : {},
            error: opts.createError ?? null,
          };
        },
      },
    },
    from: () => ({
      update: () => ({
        in: () => ({
          select: async () => {
            traza.push('admin:delivery');
            return { data: [], error: null };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

const ADMIN_DIRECTOR = [{ id: 'm1', club_id: CLUB, role: 'director' }];

function args(over: Partial<Parameters<typeof performStaffInvite>[2]> = {}) {
  return {
    actorProfileId: ACTOR,
    clubId: CLUB,
    email: 'nueva@club.es',
    role: 'entrenador_principal' as InvitableRole,
    teamId: null,
    locale: 'es',
    linkBase: LINK_BASE,
    ...over,
  };
}

function puertos(
  over: {
    link?: ReturnType<typeof vi.fn>;
    sendEmail?: ReturnType<typeof vi.fn>;
    lookup?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    link: over.link ?? vi.fn(async () => ({ ok: true })),
    sendEmail: over.sendEmail ?? vi.fn(async () => ({ error: null, id: 'msg-1' })),
    lookup: over.lookup ?? vi.fn(async () => null),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('W-6 · quién invita y a qué', () => {
  it('admin_club y director invitan; el coordinador NO', () => {
    expect(canInviteToClub('admin_club')).toBe(true);
    expect(canInviteToClub('director')).toBe(true);
    // E-final-2 se la retiró: su gestión de staff es la serie W, sobre SUS equipos.
    expect(canInviteToClub('coordinador')).toBe(false);
  });

  it('los entrenadores y el jugador no invitan, ni sin rol', () => {
    expect(canInviteToClub('entrenador_principal')).toBe(false);
    expect(canInviteToClub('entrenador_ayudante')).toBe(false);
    expect(canInviteToClub('jugador')).toBe(false);
    expect(canInviteToClub(null)).toBe(false);
    expect(canInviteToClub(undefined)).toBe(false);
  });

  it('los roles ALTOS son exactamente los de `membership_role_is_high`', () => {
    // La función SQL dice: select p_role in ('admin_club','director')
    expect(isHighClubRole('admin_club')).toBe(true);
    expect(isHighClubRole('director')).toBe(true);
    for (const r of ['coordinador', 'entrenador_principal', 'entrenador_ayudante', 'jugador'] as const) {
      expect(isHighClubRole(r)).toBe(false);
    }
  });

  it('quien no es owner NO puede ofrecer los roles altos', () => {
    const ofrece = invitableRoles({ role: 'director', isOwner: false });
    expect(ofrece).not.toContain('admin_club');
    expect(ofrece).not.toContain('director');
    expect(ofrece).toEqual([
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ]);
  });

  it('el owner los ofrece todos', () => {
    const ofrece = invitableRoles({ role: 'admin_club', isOwner: true });
    expect(ofrece).toContain('admin_club');
    expect(ofrece).toContain('director');
    expect(ofrece).toHaveLength(6);
  });

  it('ser owner NO le sirve a quien no puede invitar', () => {
    // El owner es una columna del club, no un papel: hay que pasar las DOS puertas.
    expect(invitableRoles({ role: 'coordinador', isOwner: true })).toEqual([]);
    expect(invitableRoles({ role: null, isOwner: true })).toEqual([]);
  });
});

describe('W-6 · qué pendiente es la de este correo', () => {
  const filas = [
    { id: 'a', email: 'Ana@Club.es', role: 'coordinador' },
    { id: 'b', email: 'pepe_ruiz@club.es', role: 'jugador' },
  ];

  it('casa ignorando mayúsculas y espacios', () => {
    expect(matchPendingByEmail(filas, ' ana@club.es ')?.id).toBe('a');
    expect(matchPendingByEmail(filas, 'ANA@CLUB.ES')?.id).toBe('a');
  });

  it('el `_` NO es un comodín (lo sería con ilike)', () => {
    // pepeXruiz@club.es casaría con ilike 'pepe_ruiz@club.es'. Aquí no.
    expect(matchPendingByEmail(filas, 'pepeXruiz@club.es')).toBeNull();
    expect(matchPendingByEmail(filas, 'pepe_ruiz@club.es')?.id).toBe('b');
  });

  it('un correo sin pendiente da null', () => {
    expect(matchPendingByEmail(filas, 'otra@club.es')).toBeNull();
  });

  it('un correo VACÍO no casa con nada, ni con una fila de correo nulo', () => {
    // Sin la guarda, `'' === ''` convertía esto en «renueva la primera fila rota».
    // Hoy no es alcanzable (la columna es not null con CHECK, y el correo pasa por el
    // schema), pero la función no tiene por qué depender de eso para ser correcta.
    expect(matchPendingByEmail([{ id: 'c', email: null }], '')).toBeNull();
    expect(matchPendingByEmail(filas, '   ')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('W-6 · el ORDEN es el candado', () => {
  it('el admin NO aparece antes de que exista la fila de invitación', async () => {
    // Éste es el test que protege el invariante. Si alguien sube el admin por encima
    // del INSERT, el gate (la RLS del INSERT con el cliente del usuario) deja de
    // correr y NADA falla: la invitación se crearía igual, sin permiso.
    const traza: string[] = [];
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, traza }),
      clienteAdmin({ traza }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
      undefined,
      undefined,
    );
    const iEscritura = traza.indexOf('write:invitations:insert');
    const iAdmin = traza.findIndex((t) => t.startsWith('admin:'));
    expect(iEscritura, 'no se escribió la invitación').toBeGreaterThan(-1);
    expect(iAdmin, 'el admin no se usó').toBeGreaterThan(-1);
    expect(iAdmin).toBeGreaterThan(iEscritura);
  });

  it('a un rol sin permiso no se le escribe NADA, y el admin no se toca', async () => {
    const traza: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: [{ id: 'm', club_id: CLUB, role: 'coordinador' }], traza }),
      clienteAdmin({ traza }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'forbidden' });
    expect(traza.filter((t) => t.startsWith('write:'))).toEqual([]);
    expect(traza.filter((t) => t.startsWith('admin:'))).toEqual([]);
    expect(p.sendEmail).not.toHaveBeenCalled();
  });
});

describe('W-6 · los permisos', () => {
  it('sin membresías, no_club', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: [] }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'no_club' });
  });

  it('si la lectura de membresías falla, no_club (y se reporta)', async () => {
    const errores: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ errorMembresias: { code: '42501' } }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
      (_e, step) => errores.push(step),
    );
    expect(res).toEqual({ error: 'no_club' });
    expect(errores).toContain('read_memberships');
  });

  it('un rol ALTO sin ser el owner, forbidden y sin escribir', async () => {
    const traza: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, owner: 'OTRO-perfil', traza }),
      clienteAdmin({ traza }),
      args({ role: 'director' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'forbidden' });
    expect(traza.filter((t) => t.startsWith('write:'))).toEqual([]);
  });

  it('un rol ALTO siendo el owner, sigue adelante', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, owner: ACTOR }),
      clienteAdmin({}),
      args({ role: 'admin_club' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok?.covered).toBe(false);
    expect(p.sendEmail).toHaveBeenCalled();
  });

  it('un rol BAJO no pregunta por el owner', async () => {
    const traza: string[] = [];
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, traza }),
      clienteAdmin({ traza }),
      args({ role: 'coordinador' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(traza).not.toContain('read:clubs');
  });
});

describe('W-6 · el correo ya es de alguien del club', () => {
  it('no se crea invitación ni sale correo: se dice quién es', async () => {
    const traza: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        miembro: [{ membership_id: 'm-9', full_name: 'Ana Ruiz', role: 'entrenador_ayudante' }],
        traza,
      }),
      clienteAdmin({ traza }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.existingMember).toEqual({
      membershipId: 'm-9',
      fullName: 'Ana Ruiz',
      clubRole: 'entrenador_ayudante',
      hasFicha: true,
    });
    expect(traza.filter((t) => t.startsWith('write:'))).toEqual([]);
    expect(p.sendEmail).not.toHaveBeenCalled();
  });

  it('un rol `jugador` NO tiene ficha de cuerpo técnico', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        miembro: [{ membership_id: 'm-8', full_name: null, role: 'jugador' }],
      }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.existingMember?.hasFicha).toBe(false);
    // Sin nombre se pone un guion, no una cadena vacía que dejaría un hueco.
    expect(res.existingMember?.fullName).toBe('—');
  });

  it('si el atajo falla, se invita igual (la pantalla no se queda muerta)', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, errorMiembro: { message: 'boom' } }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok?.covered).toBe(false);
    expect(p.sendEmail).toHaveBeenCalled();
  });
});

describe('W-6 · crear o renovar', () => {
  it('sin pendiente, INSERTA con el club, el rol, el equipo y quién invita', async () => {
    let fila: Record<string, unknown> | null = null;
    const user = clienteUsuario({ membresias: ADMIN_DIRECTOR });
    const original = (user as unknown as { from: (t: string) => unknown }).from;
    (user as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = original(t) as Record<string, unknown>;
      const ins = b.insert as (f: Record<string, unknown>) => unknown;
      b.insert = (f: Record<string, unknown>) => {
        fila = f;
        return ins(f);
      };
      return b;
    };
    const p = puertos();
    const res = await performStaffInvite(
      user,
      clienteAdmin({}),
      args({ teamId: 'equipo-1', role: 'entrenador_ayudante' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok?.covered).toBe(false);
    expect(fila).toEqual({
      email: 'nueva@club.es',
      role: 'entrenador_ayudante',
      club_id: CLUB,
      team_id: 'equipo-1',
      created_by: ACTOR,
    });
  });

  it('con pendiente del MISMO correo (otras mayúsculas), RENUEVA y no inserta', async () => {
    const traza: string[] = [];
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        pendientes: [{ id: 'inv-vieja', email: 'NUEVA@club.es', role: 'coordinador' }],
        pendientesDelCorreo: [{ invitation_id: 'inv-vieja' }],
        traza,
      }),
      clienteAdmin({ traza }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(traza).toContain('write:invitations:update');
    expect(traza).not.toContain('write:invitations:insert');
  });

  it('renovar pisa el rol y estrena token y caducidad', async () => {
    let patch: Record<string, unknown> | null = null;
    const user = clienteUsuario({
      membresias: ADMIN_DIRECTOR,
      pendientes: [{ id: 'inv-vieja', email: 'nueva@club.es', role: 'coordinador' }],
      pendientesDelCorreo: [{ invitation_id: 'inv-vieja' }],
    });
    const original = (user as unknown as { from: (t: string) => unknown }).from;
    (user as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = original(t) as Record<string, unknown>;
      const upd = b.update as (f: Record<string, unknown>) => unknown;
      b.update = (f: Record<string, unknown>) => {
        patch = f;
        return upd(f);
      };
      return b;
    };
    const p = puertos();
    const antes = Date.now();
    await performStaffInvite(
      user,
      clienteAdmin({}),
      args({ role: 'entrenador_principal' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    const q = patch as unknown as Record<string, unknown> | null;
    expect(q?.['role']).toBe('entrenador_principal');
    expect(typeof q?.['token']).toBe('string');
    expect((q?.['token'] as string).length).toBeGreaterThan(10);
    const caduca = new Date(q?.['expires_at'] as string).getTime();
    // +7 días, con holgura para el tiempo de ejecución.
    expect(caduca - antes).toBeGreaterThan(6.9 * 86_400_000);
    expect(caduca - antes).toBeLessThan(7.1 * 86_400_000);
  });

  it('NO renueva la invitación del TUTOR: la crea aparte', async () => {
    // La regla que protege el vínculo familiar. El circuito de tutor escribe en esta
    // misma tabla con `role='jugador'` y un `player_id`; renovar ESA fila le pisaría
    // el player_id y la relación, que es lo único que crea el vínculo al aceptar.
    // Así que nombrar delegada a una madre que tiene pendiente la invitación de su
    // hija INSERTA una fila nueva, no toca la suya.
    const traza: string[] = [];
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        pendientes: [
          { id: 'inv-de-su-hija', email: 'nueva@club.es', role: 'jugador', playerId: 'jug-1' },
        ],
        pendientesDelCorreo: [{ invitation_id: 'inv-de-su-hija' }],
        traza,
      }),
      clienteAdmin({ traza }),
      args({ role: 'entrenador_ayudante' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(traza).toContain('write:invitations:insert');
    expect(traza).not.toContain('write:invitations:update');
  });

  it('un 42501 al insertar es forbidden, no generic', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, errorInsert: { code: '42501' } }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'forbidden' });
  });

  it('un 42501 al renovar también es forbidden', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        pendientes: [{ id: 'inv-vieja', email: 'nueva@club.es', role: 'coordinador' }],
        errorUpdate: { code: '42501' },
      }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'forbidden' });
  });

  it('si no se pueden leer las pendientes, generic y NO se inserta a ciegas', async () => {
    const traza: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        errorPendientes: { code: '42501' },
        traza,
      }),
      clienteAdmin({ traza }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'generic' });
    expect(traza.filter((t) => t.startsWith('write:'))).toEqual([]);
  });
});

describe('W-6 · a una persona se le escribe UNA vez', () => {
  it('fila nueva y el correo ya tenía OTRA pendiente: no sale correo', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        // La otra pendiente lleva jugador, así que no está en la lista de renovables.
        pendientesDelCorreo: [{ invitation_id: 'inv-de-su-hija' }],
      }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok).toEqual({ email: 'nueva@club.es', covered: true });
    expect(p.sendEmail).not.toHaveBeenCalled();
  });

  it('renovar LA SUYA sí manda: es un reenvío a mano', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        pendientes: [{ id: 'inv-suya', email: 'nueva@club.es', role: 'coordinador' }],
        pendientesDelCorreo: [{ invitation_id: 'inv-suya' }],
      }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok?.covered).toBe(false);
    expect(p.sendEmail).toHaveBeenCalled();
  });

  it('la cuenta se crea y se enlaza IGUAL cuando no sale correo', async () => {
    // El invitado entra por el enlace que ya tiene, y ese enlace necesita la cuenta
    // enlazada. Suprimir el correo no puede suprimir la cuenta.
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        pendientesDelCorreo: [{ invitation_id: 'otra' }],
      }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(p.link).toHaveBeenCalledWith('inv-nueva', 'auth-1');
  });

  it('si la RPC de pendientes falla, FALLA ABIERTO y el correo sale', async () => {
    // Un fallo del atajo no puede dejar a nadie sin su correo. El precio es un correo
    // de más en un caso que además se reporta.
    const errores: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: ADMIN_DIRECTOR,
        errorPendientesRpc: { message: 'boom' },
      }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
      (_e, step) => errores.push(step),
    );
    expect(res.ok?.covered).toBe(false);
    expect(p.sendEmail).toHaveBeenCalled();
    expect(errores).toContain('send_invitation_pending_lookup');
  });
});

describe('W-6 · la cuenta del invitado', () => {
  it('sin cuenta: se crea con el correo YA confirmado y se enlaza', async () => {
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    const attrs = (clienteAdmin as unknown as { ultimo?: Record<string, unknown> }).ultimo;
    // Sin `email_confirm`, GoTrue le niega el login al fijar la contraseña (BUG-4).
    expect(attrs?.['email_confirm']).toBe(true);
    expect(p.link).toHaveBeenCalledWith('inv-nueva', 'auth-1');
  });

  it('cuenta creada por una invitación anterior y sin reclamar: se ENLAZA ésa', async () => {
    // Sin esto, reinvitar deja al invitado pidiéndole una contraseña que nunca fijó.
    const traza: string[] = [];
    const p = puertos({
      lookup: vi.fn(async () => ({ userId: 'auth-viejo', invitePending: true, locale: 'va' })),
    });
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, traza }),
      clienteAdmin({ traza }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(p.link).toHaveBeenCalledWith('inv-nueva', 'auth-viejo');
    expect(traza).not.toContain('admin:createUser');
  });

  it('cuenta suya de verdad: no se crea, no se enlaza', async () => {
    const traza: string[] = [];
    const p = puertos({
      lookup: vi.fn(async () => ({ userId: 'auth-suyo', invitePending: false, locale: 'en' })),
    });
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, traza }),
      clienteAdmin({ traza }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(traza).not.toContain('admin:createUser');
    expect(p.link).not.toHaveBeenCalled();
    expect(res.ok?.covered).toBe(false);
  });

  it('se le escribe en SU idioma, no en el de quien invita', async () => {
    const p = puertos({
      lookup: vi.fn(async () => ({ userId: 'x', invitePending: false, locale: 'va' })),
    });
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args({ locale: 'es' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(p.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'va' }),
    );
  });

  it('sin perfil del destinatario, el idioma de reserva es el de quien invita', async () => {
    const p = puertos({
      lookup: vi.fn(async () => ({ userId: 'x', invitePending: false, locale: null })),
    });
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args({ locale: 'en' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(p.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });

  it('si la búsqueda LANZA, se sigue por el camino normal y se reporta', async () => {
    const errores: string[] = [];
    const p = puertos({
      lookup: vi.fn(async () => {
        throw new Error('red');
      }),
    });
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
      (_e, step) => errores.push(step),
    );
    expect(errores).toContain('lookup_recipient_thrown');
    expect(res.ok?.covered).toBe(false);
  });

  it('carrera al crear (el correo ya existía): se sigue y el correo sale', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({ createError: { code: 'email_exists' } }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok?.covered).toBe(false);
    expect(p.sendEmail).toHaveBeenCalled();
  });

  it('otro error de creación corta, y NO sale correo', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({ createError: { message: 'database is down', status: 500 } }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'generic' });
    expect(p.sendEmail).not.toHaveBeenCalled();
  });

  it('creación SIN user.id: corta ruidosamente en vez de dar por buena una invitación rota', async () => {
    const errores: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({ invitedUserId: null }),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
      (_e, step) => errores.push(step),
    );
    expect(res).toEqual({ error: 'generic' });
    expect(errores).toContain('invited_user_missing_id');
    expect(p.sendEmail).not.toHaveBeenCalled();
  });

  it('si el ENLAZADO falla, no sale correo', async () => {
    // Un enlace que no lleva a ninguna parte es peor que no mandar nada.
    const p = puertos({ link: vi.fn(async () => ({ ok: false })) });
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'generic' });
    expect(p.sendEmail).not.toHaveBeenCalled();
  });
});

describe('W-6 · el correo que sale', () => {
  it('lleva el enlace con el token de ESTA invitación', async () => {
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(p.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'nueva@club.es',
        url: `${LINK_BASE}/tok-nuevo`,
      }),
    );
  });

  it('lleva el ROL con el que se invita (el correo lo dice)', async () => {
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args({ role: 'coordinador' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(p.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'coordinador' }),
    );
  });

  it('si el correo falla, generic (la invitación queda y se puede rehacer)', async () => {
    const errores: string[] = [];
    const p = puertos({ sendEmail: vi.fn(async () => ({ error: new Error('resend') })) });
    const res = await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
      (_e, step) => errores.push(step),
    );
    expect(res).toEqual({ error: 'generic' });
    expect(errores).toContain('send_invite_email');
  });

  it('a los puertos de LOG no se les pasa nunca el correo', async () => {
    // El enmascarado vive donde vive el logger; core no puede filtrar PII porque no la
    // tiene en la mano. Esto lo fija.
    const vistos: unknown[] = [];
    const p = puertos();
    await performStaffInvite(
      clienteUsuario({ membresias: ADMIN_DIRECTOR, errorMiembro: { message: 'boom' } }),
      clienteAdmin({}),
      args(),
      p.link,
      p.sendEmail,
      p.lookup,
      (_e, step, extra) => vistos.push({ step, extra }),
      (event, extra) => vistos.push({ event, extra }),
    );
    expect(JSON.stringify(vistos)).not.toContain('nueva@club.es');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL CLUB LO DECIDE EL LLAMANTE (no se adivina)
//
// Antes, core elegía con `memberships.find((m) => canInviteToClub(m.role))` —«el
// primer club donde puedo invitar»— sobre una consulta SIN `order by`. Con dos
// membresías, la invitación podía nacer en el club equivocado y el correo salir
// nombrándolo. Estos tests fijan que ya no elige: comprueba.
// ═══════════════════════════════════════════════════════════════════════════

describe('el club que se invita es el que se pasa', () => {
  /** Captura la fila insertada, mismo truco que «INSERTA con el club…». */
  function conCaptura(user: SupabaseClient<Database>) {
    const caja: { fila: Record<string, unknown> | null } = { fila: null };
    const original = (user as unknown as { from: (t: string) => unknown }).from;
    (user as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = original(t) as Record<string, unknown>;
      const ins = b.insert as (f: Record<string, unknown>) => unknown;
      b.insert = (f: Record<string, unknown>) => {
        caja.fila = f;
        return ins(f);
      };
      return b;
    };
    return caja;
  }

  it('con DOS membresías, inserta en el club pedido y no en el primero de la lista', async () => {
    // El orden es a propósito: `otro-club` va PRIMERO y su rol invita, así que es
    // justo el que elegía el código viejo. CLUB va segundo.
    const user = clienteUsuario({
      membresias: [
        { id: 'm-otro', club_id: 'otro-club', role: 'director' },
        { id: 'm1', club_id: CLUB, role: 'admin_club' },
      ],
    });
    const caja = conCaptura(user);
    const p = puertos();
    const res = await performStaffInvite(
      user,
      clienteAdmin({}),
      args({ clubId: CLUB }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok, 'la invitación no se creó').toBeTruthy();
    expect(caja.fila?.club_id).toBe(CLUB);
    expect(caja.fila?.club_id).not.toBe('otro-club');
  });

  it('y al revés: pidiendo el otro club, inserta en el otro', async () => {
    // El control que prueba que el test de arriba mide algo: si el club saliera de
    // la lista y no del argumento, los dos darían lo mismo.
    const user = clienteUsuario({
      membresias: [
        { id: 'm-otro', club_id: 'otro-club', role: 'director' },
        { id: 'm1', club_id: CLUB, role: 'admin_club' },
      ],
    });
    const caja = conCaptura(user);
    const p = puertos();
    await performStaffInvite(
      user,
      clienteAdmin({}),
      args({ clubId: 'otro-club' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(caja.fila?.club_id).toBe('otro-club');
  });

  it('el ROL se mide EN ESE club: jugador aquí y director en otro = forbidden', async () => {
    // Este es el que el código viejo dejaba pasar: encontraba el `director` de otro
    // club, lo daba por bueno, y escribía en el club de ese director.
    const user = clienteUsuario({
      membresias: [
        { id: 'm-otro', club_id: 'otro-club', role: 'director' },
        { id: 'm1', club_id: CLUB, role: 'jugador' },
      ],
      traza: [],
    });
    const p = puertos();
    const res = await performStaffInvite(
      user,
      clienteAdmin({}),
      args({ clubId: CLUB }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.error).toBe('forbidden');
    expect(p.sendEmail, 'no debe salir correo').not.toHaveBeenCalled();
  });

  it('sin membresía en ese club y sin ser superadmin → no_club', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: [{ id: 'm-otro', club_id: 'otro-club', role: 'director' }] }),
      clienteAdmin({}),
      args({ clubId: CLUB }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.error).toBe('no_club');
    expect(p.sendEmail).not.toHaveBeenCalled();
  });

  it('SUPERADMIN sin membresía en ese club SÍ invita (F14B-2 ya se lo permite en la RLS)', async () => {
    const user = clienteUsuario({
      membresias: [{ id: 'm-otro', club_id: 'otro-club', role: 'director' }],
      esSuperadmin: true,
    });
    const caja = conCaptura(user);
    const p = puertos();
    const res = await performStaffInvite(
      user,
      clienteAdmin({}),
      args({ clubId: CLUB }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok, 'al superadmin se le negó el club ajeno').toBeTruthy();
    expect(caja.fila?.club_id).toBe(CLUB);
  });

  it('y sin el escape de superadmin, ese mismo caso es no_club', async () => {
    // Control negativo del escape: con `esSuperadmin: false` el mismo montaje
    // tiene que fallar, o el test de arriba no estaría midiendo el escape.
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({
        membresias: [{ id: 'm-otro', club_id: 'otro-club', role: 'director' }],
        esSuperadmin: false,
      }),
      clienteAdmin({}),
      args({ clubId: CLUB }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.error).toBe('no_club');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL SUPERADMIN REPARTE ROLES ALTOS (paridad-owner, RM-2)
//
// El pre-gate de rol alto comparaba `clubs.owner_profile_id !== actorProfileId` a
// secas, copia de `user_is_club_owner` ANTES de que RM-2 (28-09-2026) le añadiera
// la rama `is_superadmin()`. Un mes más estricto que la RLS que dice reimponer: la
// pantalla ofrecía «director» —el shell fabrica `isOwner: true` citando RM-2— y al
// enviar contestaba «No tienes permiso para invitar en este club».
//
// Y el caso que lo sacó a la luz es el peor de los dos: UDFonteta tiene
// `owner_profile_id` NULL, así que el `!==` no comparaba dos personas, comparaba
// NULL. Por eso el primer test de aquí abajo monta `owner: null`.
//
// OJO con la función vecina: `profile_is_club_owner` (el OBJETIVO) NO es
// superadmin-aware a propósito y no se toca. Ver el comentario del gate.
// ═══════════════════════════════════════════════════════════════════════════

describe('el superadmin reparte roles ALTOS (paridad-owner)', () => {
  const EN_OTRO = [{ id: 'm-otro', club_id: 'otro-club', role: 'director' }];
  const DIRECTOR_AQUI = [{ id: 'm1', club_id: CLUB, role: 'director' }];

  it('club SIN owner: el superadmin invita director (el caso de UDFonteta)', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: EN_OTRO, owner: null, esSuperadmin: true }),
      clienteAdmin({}),
      args({ role: 'director' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.error, 'el pre-gate volvió a negar el rol alto').toBeUndefined();
    expect(res.ok).toBeTruthy();
    expect(p.sendEmail).toHaveBeenCalled();
  });

  it('club CON otro owner: el superadmin también (la RLS es un OR, no un AND)', async () => {
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: EN_OTRO, owner: 'OTRO-perfil', esSuperadmin: true }),
      clienteAdmin({}),
      args({ role: 'admin_club' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok, 'owner ajeno: el superadmin sigue actuando como owner').toBeTruthy();
  });

  it('con membresía en el club pero sin ser owner, el superadmin reparte igual', async () => {
    // Un superadmin puede tener membresía real donde no es owner. La RLS no mira la
    // membresía para el rol alto: mira `user_is_club_owner`, que es TRUE para él.
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: DIRECTOR_AQUI, owner: 'OTRO-perfil', esSuperadmin: true }),
      clienteAdmin({}),
      args({ role: 'director' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok).toBeTruthy();
  });

  it('un director normal sin owner asignado NO cuela por el hueco del NULL', async () => {
    // Control de la dirección peligrosa: que el club no tenga owner no abre la
    // puerta a cualquiera. Solo el superadmin salta ese gate.
    const traza: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: DIRECTOR_AQUI, owner: null, esSuperadmin: false, traza }),
      clienteAdmin({ traza }),
      args({ role: 'director' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res).toEqual({ error: 'forbidden' });
    expect(traza.filter((t) => t.startsWith('write:'))).toEqual([]);
    expect(p.sendEmail).not.toHaveBeenCalled();
  });

  it('el owner REAL no gasta la RPC: el OR mira primero la columna', async () => {
    // Fija el orden del OR, que está al revés que en SQL a propósito: un director
    // normal invitando no debe pagar una consulta más.
    const traza: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: DIRECTOR_AQUI, owner: ACTOR, traza }),
      clienteAdmin({ traza }),
      args({ role: 'director' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok).toBeTruthy();
    expect(traza).not.toContain('rpc:is_superadmin');
  });

  it('`is_superadmin` se consulta UNA vez aunque la pidan las dos puertas', async () => {
    // Sin membresía en el club Y con rol alto: el gate de rol y el de rol alto
    // preguntan los dos. La respuesta se memoriza.
    const traza: string[] = [];
    const p = puertos();
    const res = await performStaffInvite(
      clienteUsuario({ membresias: EN_OTRO, owner: null, esSuperadmin: true, traza }),
      clienteAdmin({ traza }),
      args({ role: 'director' }),
      p.link,
      p.sendEmail,
      p.lookup,
    );
    expect(res.ok).toBeTruthy();
    expect(traza.filter((t) => t === 'rpc:is_superadmin')).toHaveLength(1);
  });
});
