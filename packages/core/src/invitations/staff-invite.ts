import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import { STAFF_ROLES } from '../auth/roles';
import { inviteEmailMetadata } from './invite-email-metadata';
import { pendingCoversEmail, type PendingInvitationRow } from './pending';
import { recordInvitationDelivery } from './delivery';
import {
  isEmailAlreadyExistsError,
  type LinkInvitedUser,
  type LookupInviteRecipient,
} from '../spectators/index';

type DbClient = SupabaseClient<Database>;

/**
 * W-6 — INVITAR A ALGUIEN QUE NO ESTÁ EN EL CLUB. La pieza más delicada de la serie,
 * y la única que de verdad necesita un endpoint.
 *
 * Bajada de `apps/web/src/app/[locale]/(authenticated)/invitations/actions.ts`
 * (763 líneas, ejecutadas por nadie: `apps/web` no tiene runner). No es un movimiento
 * de conveniencia: aquí viven la cuenta del invitado, su idioma y su único enlace
 * válido, y cada rama de esto se pagó con un incidente.
 *
 * ── POR QUÉ ESTA SÍ LLEVA ENDPOINT, y W-5 no ───────────────────────────────
 * Las cuatro piezas anteriores escribían tablas o llamaban RPC: eso lo hace la app
 * con su propia sesión, porque el gate es la RLS. Esto NO. Crear la cuenta del
 * invitado (`admin.auth.admin.createUser`), buscarla y ENLAZARLA exige la
 * service-role, que jamás puede vivir en un teléfono. Así que la app llama a un route
 * handler con su bearer y el handler pone el admin — el mismo reparto que
 * `performSpectatorInvite`, que ya lo hace desde O2-5.
 *
 * ── EL ORDEN ES EL CANDADO (invariante) ────────────────────────────────────
 *   1. Los permisos y la FILA de invitación se escriben con el cliente DEL USUARIO,
 *      así que pasan por `invitations_insert_admin`. Ese es el gate de verdad.
 *   2. El admin aparece DESPUÉS, y solo para la cuenta y el correo.
 * Si algún día alguien mueve el admin más arriba, el gate desaparece sin que nada
 * falle: la invitación se crearía igual. De ahí que esté escrito aquí y en el handler.
 *
 * ── LOS PUERTOS: core no sabe de Sentry, ni de Resend, ni de next-intl ─────
 * Se inyectan enlazado, correo y búsqueda del destinatario, igual que en el
 * seguidor. Y con una mejora: a los puertos de LOG no se les pasa nunca el correo,
 * solo pasos e identificadores. El enmascarado vive donde vive el logger, y core no
 * puede filtrar PII porque no la tiene en la mano.
 */

/** Los roles que se pueden invitar, tal como los acepta `sendInvitationSchema`. */
export type InvitableRole = Extract<
  Role,
  | 'admin_club'
  | 'director'
  | 'coordinador'
  | 'entrenador_principal'
  | 'entrenador_ayudante'
  | 'jugador'
>;

/**
 * ¿Puede este rol invitar al club?
 *
 * Espejo de la rama `else` de `invitations_insert_admin`:
 *   `user_role_in_club(club_id) = any (array['admin_club','director'])`
 *
 * El COORDINADOR queda fuera (E-final-2 se la retiró a propósito): su gestión de
 * staff vive en Cuerpo técnico, sobre los equipos que coordina, y esa es la serie W
 * entera. Nada que ver con dar de alta a alguien nuevo en el club.
 */
export function canInviteToClub(role: Role | null | undefined): boolean {
  return role === 'admin_club' || role === 'director';
}

/**
 * ¿Es un rol ALTO, de los que solo el OWNER del club puede repartir?
 *
 * Espejo exacto de la función SQL `membership_role_is_high(text)`, verificada:
 *   `select p_role in ('admin_club', 'director');`
 *
 * Y ojo con la coincidencia: es la MISMA lista que `canInviteToClub`, pero no es la
 * misma regla. Una dice quién invita; la otra, a qué se puede invitar. Un
 * `director` puede invitar y NO puede nombrar otro director si no es el owner.
 */
export function isHighClubRole(role: Role | null | undefined): boolean {
  return role === 'admin_club' || role === 'director';
}

/**
 * QUÉ ROLES puede ofrecer este actor. Es la combinación de las dos reglas de arriba,
 * y existe para que ninguna pantalla la recomponga a mano: la web tenía las dos
 * listas sueltas y la app habría hecho una tercera.
 *
 * `isOwner` no se deduce del rol: el owner es una columna del club
 * (`clubs.owner_profile_id`), no un papel. Un admin_club que no es el owner existe y
 * es el caso que esto protege.
 */
export function invitableRoles(actor: {
  role: Role | null | undefined;
  isOwner: boolean;
}): InvitableRole[] {
  if (!canInviteToClub(actor.role)) return [];
  const bajos: InvitableRole[] = [
    'coordinador',
    'entrenador_principal',
    'entrenador_ayudante',
    'jugador',
  ];
  return actor.isOwner ? (['admin_club', 'director'] as InvitableRole[]).concat(bajos) : bajos;
}

/** Una pendiente de club, tal como hace falta para decidir si se renueva. */
export type PendingClubInvitation = { id: string; email: string | null; role: string };

/**
 * ¿Cuál de las pendientes es la de ESTE correo?
 *
 * La comparación va en JS y en minúsculas, y las dos cosas son deliberadas:
 *
 *   · `invitations.email` guarda LO QUE SE ESCRIBIÓ (el schema hace `trim`, no
 *     `lower`), así que un `.eq()` dejaría pasar "Ana@club.es" frente a
 *     "ana@club.es" y crearía justo el duplicado que esto evita;
 *   · `ilike` tampoco sirve: `_` y `%` son sus comodines y un correo puede llevar un
 *     `_`, así que `pepe_ruiz@club.es` casaría con `pepeXruiz@club.es`.
 *
 * Eso estaba medido y escrito en la web, y sin test. Aquí lo hay.
 *
 * Y un correo VACÍO no casa con nada, aunque una fila lo tuviera nulo: sin ese
 * cierre, `'' === ''` convertía la comparación en «renueva la primera fila rota que
 * encuentres». Hoy es inalcanzable —la columna es `not null` con CHECK de formato, y
 * el correo entra por el schema—, pero esta función ya vive en core y no tiene por
 * qué depender de las dos cosas para ser correcta.
 */
export function matchPendingByEmail<T extends { email: string | null }>(
  pending: readonly T[],
  email: string,
): T | null {
  const buscado = email.trim().toLowerCase();
  if (buscado.length === 0) return null;
  return pending.find((p) => (p.email ?? '').trim().toLowerCase() === buscado) ?? null;
}

/**
 * Las pendientes vigentes de un correo en un club, por RPC.
 *
 * Va por RPC (`club_pending_invitation_by_email`) y no por un `select`: la policy de
 * `invitations` solo deja leer la tabla a dirección, al invitado y a quien creó la
 * fila, y esto lo pregunta también un entrenador —puede crear jugadores, y crear un
 * jugador dispara la invitación del tutor—. Con un `select` vería cero pendientes y
 * mandaría un segundo correo a la misma persona.
 *
 * FALLA ABIERTO a propósito: si la RPC tropieza, lista vacía, que significa «no hay
 * nada pendiente» y lleva al camino de siempre (invitar). Un fallo del atajo no puede
 * dejar a un padre sin su correo; el precio es un correo de más en un caso que además
 * se reporta.
 */
export async function pendingInvitationsForEmailFromClient(
  supabase: DbClient,
  clubId: string,
  email: string,
  logError?: (err: unknown, step: string, extra?: Record<string, unknown>) => void,
  step = 'pending_invitation_by_email',
): Promise<PendingInvitationRow[]> {
  const { data, error } = await supabase.rpc('club_pending_invitation_by_email', {
    p_club_id: clubId,
    p_email: email,
  });
  if (error) {
    logError?.(error, step, { club_id: clubId });
    return [];
  }
  return (data ?? []).map((row) => ({ id: row.invitation_id }));
}

/**
 * PUERTO DE CORREO de la invitación de club.
 *
 * Difiere del del seguidor en un campo, `role`, y no es un detalle: esta pantalla no
 * invita solo a cuerpo técnico —también nombra administración, dirección,
 * coordinación o familia—, y el correo lo DICE. Con la plantilla única de GoTrue los
 * seis recibían el mismo texto.
 */
export type SendStaffInvitationEmail = (args: {
  to: string;
  url: string;
  locale: string;
  role: string;
}) => Promise<{ error: unknown | null; id?: string }>;

/** Puerto de traza: pasos e identificadores, NUNCA el correo. */
export type StaffInviteInfoLogger = (
  event: string,
  extra?: Record<string, unknown>,
) => void;

export type StaffInviteErrorLogger = (
  err: unknown,
  step: string,
  extra?: Record<string, unknown>,
) => void;

export type StaffInviteError = 'invalid_input' | 'forbidden' | 'no_club' | 'generic';

/** Quien ya está DENTRO del club: no se crea invitación ni sale correo. */
export type StaffInviteExistingMember = {
  membershipId: string;
  fullName: string;
  clubRole: string;
  /** ¿Tiene ficha en Cuerpo técnico? La de un rol `jugador` no existe: es una familia. */
  hasFicha: boolean;
};

export type StaffInviteResult =
  | { ok: { email: string; covered: boolean }; error?: undefined; existingMember?: undefined }
  | { existingMember: StaffInviteExistingMember; ok?: undefined; error?: undefined }
  | { error: StaffInviteError; ok?: undefined; existingMember?: undefined };

const SIETE_DIAS_MS = 7 * 86_400_000;

/**
 * EL FLUJO COMPLETO, en el orden que importa.
 *
 *  1. Rol del actor y, si el rol invitado es alto, que sea el OWNER.
 *  2. ¿Ese correo YA es de alguien del club? Entonces la invitación no sirve para
 *     nada y no se deja ni la fila (ver abajo).
 *  3. RENOVAR la pendiente de ese correo, o INSERTAR una nueva. Con el cliente del
 *     usuario: ahí está el gate.
 *  4. Con el ADMIN: buscar al destinatario, crear su cuenta si no la tiene, ENLAZARLA.
 *  5. El correo, lo último — y solo si no está ya cubierto.
 *
 * La cuenta y el enlazado van ANTES del correo. Si el correo falla queda una
 * invitación válida que se cancela y se rehace; al revés, el invitado tendría un
 * enlace que no lleva a ninguna parte.
 */
export async function performStaffInvite(
  userSupabase: DbClient,
  admin: DbClient,
  args: {
    actorProfileId: string;
    email: string;
    role: InvitableRole;
    teamId: string | null;
    /** Idioma de quien invita: es el de reserva si el destinatario no tiene perfil. */
    locale: string;
    /** `inviteLinkBase(locale)`; el enlace final es `${linkBase}/${token}`. */
    linkBase: string;
  },
  /** Obligatorio: no se puede crear la cuenta sin traer el enlazado. */
  link: LinkInvitedUser,
  /** Obligatorio: sin él habría invitación y cuenta, y nadie avisado. */
  sendEmail: SendStaffInvitationEmail,
  /** Obligatorio: sin él, reenviar una invitación sin reclamar deja al invitado fuera. */
  lookup: LookupInviteRecipient,
  logError?: StaffInviteErrorLogger,
  logInfo?: StaffInviteInfoLogger,
): Promise<StaffInviteResult> {
  const { actorProfileId, email, role, teamId, locale, linkBase } = args;
  const errar: StaffInviteErrorLogger = logError ?? (() => {});
  const trazar: StaffInviteInfoLogger = logInfo ?? (() => {});

  // ── 1. ¿Quién invita? ──────────────────────────────────────────────────────
  const { data: memberships, error: mErr } = await userSupabase
    .from('memberships')
    .select('id, club_id, role')
    .eq('profile_id', actorProfileId);

  if (mErr) {
    errar(mErr, 'read_memberships', { user_id: actorProfileId });
    return { error: 'no_club' };
  }
  if (!memberships || memberships.length === 0) {
    trazar('no_memberships_found');
    return { error: 'no_club' };
  }

  const autorizada = memberships.find((m) => canInviteToClub(m.role as Role));
  if (!autorizada) {
    trazar('forbidden_role', { roles: memberships.map((m) => m.role) });
    return { error: 'forbidden' };
  }
  const clubId = autorizada.club_id as string;

  // Rol ALTO: exclusivo del owner (F1B-2). Pre-gate; la RLS lo reimpone.
  if (isHighClubRole(role as Role)) {
    const { data: club } = await userSupabase
      .from('clubs')
      .select('owner_profile_id')
      .eq('id', clubId)
      .single();
    if (!club || club.owner_profile_id !== actorProfileId) {
      trazar('forbidden_high_role_requires_owner', { role });
      return { error: 'forbidden' };
    }
  }

  // ── 2. ¿Ya es del club? ────────────────────────────────────────────────────
  // Si lo es, la invitación no sirve para NADA, y el motivo es más profundo que el
  // asunto del correo: `accept_pending_invitations` hace
  //
  //   on conflict (profile_id, club_id) do update set role = case
  //     when memberships.left_at is not null then excluded.role
  //     else memberships.role end
  //
  // o sea que a un miembro ACTIVO la invitación NO le cambia el rol. Invitar a quien
  // ya está dentro «para ascenderlo» mandaba un correo y no hacía nada: la pantalla
  // prometía algo que no ocurría.
  //
  // Quien está DE BAJA no cuenta (la RPC filtra `left_at is null`) y su invitación
  // sigue su curso: es justo la que le reincorpora, porque ahí el CASE sí adopta el
  // rol nuevo.
  //
  // Va ANTES del INSERT: aquí el objetivo ERA la invitación, así que no se deja ni la
  // fila. Y si la RPC falla se sigue invitando: la pantalla no se queda muerta por un
  // fallo del atajo.
  const { data: memberRows, error: memberErr } = await userSupabase.rpc(
    'club_member_by_email',
    { p_club_id: clubId, p_email: email },
  );
  if (memberErr) errar(memberErr, 'member_lookup', { club_id: clubId });
  const existing = memberErr ? null : (memberRows ?? [])[0];
  if (existing) {
    trazar('already_member_not_invited', {
      member_role: existing.role,
      requested_role: role,
    });
    return {
      existingMember: {
        membershipId: existing.membership_id,
        fullName: existing.full_name ?? '—',
        clubRole: existing.role,
        hasFicha: (STAFF_ROLES as readonly string[]).includes(existing.role),
      },
    };
  }

  // ── 3. La fila: renovar o insertar ─────────────────────────────────────────
  // El alcance lleva `player_id is null`, y NO es un detalle: el circuito de tutor
  // escribe en esta MISMA tabla con `role='jugador'` y un `player_id`. Sin ese
  // filtro, invitar como delegada a una madre que tiene pendiente la invitación que
  // la vincula a su hijo renovaría ESA fila y le pisaría el `player_id` — lo único
  // que crea el vínculo familiar al aceptar.
  //
  // Una pendiente CADUCADA no se renueva: se crea otra. La caducada se queda hasta
  // que alguien la borre; no estorba porque ya no vale como enlace.
  const ahoraIso = new Date().toISOString();
  const { data: pendientes, error: pendErr } = await userSupabase
    .from('invitations')
    .select('id, email, role')
    .eq('club_id', clubId)
    .is('player_id', null)
    .is('accepted_at', null)
    .gt('expires_at', ahoraIso)
    .order('created_at', { ascending: false });

  if (pendErr) {
    errar(pendErr, 'pending_lookup', { club_id: clubId });
    return { error: 'generic' };
  }

  const pendiente = matchPendingByEmail(
    (pendientes ?? []) as PendingClubInvitation[],
    email,
  );

  // Y ADEMÁS, todas las pendientes de ese correo — también las que llevan jugador,
  // que la consulta de arriba descarta a propósito. Esta lista no sirve para renovar
  // nada: sirve para saber si YA SE LE ESCRIBIÓ.
  const pendientesDelCorreo = await pendingInvitationsForEmailFromClient(
    userSupabase,
    clubId,
    email,
    errar,
    'send_invitation_pending_lookup',
  );

  let invite: { id: string; token: string } | null = null;

  if (pendiente) {
    // Renovación: token nuevo (el anterior deja de valer), +7 días, y el rol y el
    // equipo de ahora. Si la pendiente era de OTRO rol se PISA: nadie ha aceptado
    // nada, y el caso real es una corrección («me equivoqué de rol»). El pre-gate de
    // rol alto ya ha corrido, así que por aquí no se asciende a nadie sin ser owner.
    const { data: renovada, error: updErr } = await userSupabase
      .from('invitations')
      .update({
        role,
        team_id: teamId ?? null,
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + SIETE_DIAS_MS).toISOString(),
      })
      .eq('id', pendiente.id)
      .select('id, token')
      .single();

    if (updErr) {
      errar(updErr, 'renew_invitation', {
        club_id: clubId,
        invitation_id: pendiente.id,
        pg_code: updErr.code ?? 'unknown',
      });
      if (updErr.code === '42501') return { error: 'forbidden' };
      return { error: 'generic' };
    }
    invite = renovada as { id: string; token: string } | null;
    if (invite) {
      trazar('renewed', {
        invitation_id: invite.id,
        rol_anterior: pendiente.role,
        role,
      });
    }
  } else {
    const { data: insertada, error: insErr } = await userSupabase
      .from('invitations')
      .insert({
        email,
        role,
        club_id: clubId,
        team_id: teamId ?? null,
        created_by: actorProfileId,
      })
      .select('id, token')
      .single();

    if (insErr) {
      errar(insErr, 'insert_invitation', {
        club_id: clubId,
        role,
        team_id: teamId ?? null,
        pg_code: insErr.code ?? 'unknown',
      });
      if (insErr.code === '42501') return { error: 'forbidden' };
      return { error: 'generic' };
    }
    invite = insertada as { id: string; token: string } | null;
    if (invite) trazar('inserted', { invitation_id: invite.id, role });
  }

  if (!invite) {
    errar(new Error('insert/update devolvió null sin error'), 'invitation_returned_null');
    return { error: 'generic' };
  }

  // ── 4. La cuenta. AQUÍ entra el admin, y no antes ──────────────────────────
  const url = `${linkBase}/${invite.token}`;

  // ¿Ya tiene cuenta? Se mira ANTES de crear nada: decide si hay cuenta que crear,
  // cuál enlazar y en qué IDIOMA escribir. Si la búsqueda tropieza se sigue por el
  // camino de «no tiene cuenta», que es el normal, y `createUser` dirá la verdad.
  let found: Awaited<ReturnType<LookupInviteRecipient>> = null;
  try {
    found = await lookup(email);
  } catch (thrown) {
    errar(thrown, 'lookup_recipient_thrown', { invitation_id: invite.id });
  }
  const emailLocale = found?.locale ?? locale;

  try {
    if (found && !found.invitePending) {
      // Cuenta suya de verdad: no se toca ni se enlaza. Acepta con su propia sesión, y
      // `invited_user_id` se queda NULL a propósito — enrutarla a set_password le
      // pediría cambiar una contraseña que ya tiene.
      trazar('cuenta_existente', { invitation_id: invite.id });
    } else if (found && found.invitePending) {
      // Cuenta que creamos en una invitación anterior y nadie reclamó: se ENLAZA ésa.
      // Sin esto, reinvitar a la misma persona la deja pidiéndole una contraseña que
      // nunca fijó — la trampa de agosto de 2026.
      const linkRes = await link(invite.id, found.userId);
      if (!linkRes.ok) return { error: 'generic' };
      trazar('invited_user_linked', { invitation_id: invite.id });
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        // Su correo ES su prueba. Sin esto GoTrue le niega el login al fijar la
        // contraseña en /invite (BUG-4).
        email_confirm: true,
        user_metadata: inviteEmailMetadata({
          invitationId: invite.id,
          kind: 'staff',
          locale: emailLocale,
        }),
      });

      if (createErr) {
        if (isEmailAlreadyExistsError(createErr)) {
          // Carrera con la búsqueda de arriba. La invitación existe y el correo sale
          // igual: se sigue.
          trazar('create_race', { invitation_id: invite.id });
        } else {
          errar(createErr, 'createUser', {
            invitation_id: invite.id,
            invite_status: String((createErr as { status?: number }).status ?? 'unknown'),
          });
          return { error: 'generic' };
        }
      } else {
        const invitedUserId = created?.user?.id ?? null;
        if (!invitedUserId) {
          // Creación OK pero SIN user.id: no es normal (antes era MUDO). Sin
          // `invited_user_id` la invitación lleva a «inicia sesión» sobre una cuenta
          // sin contraseña. Ruidoso y error, en vez de dar por buena una invitación
          // rota.
          errar(
            new Error('createUser sin user.id'),
            'invited_user_missing_id',
            { invitation_id: invite.id },
          );
          return { error: 'generic' };
        }
        // Enlaza y EXIGE 1 fila afectada: un UPDATE de cero filas no da error en
        // PostgREST y dejaría `invited_user_id` NULL en silencio (raíz del incidente).
        const linkRes = await link(invite.id, invitedUserId);
        if (!linkRes.ok) return { error: 'generic' };
        trazar('invited_user_linked', { invitation_id: invite.id });
      }
    }
  } catch (thrown) {
    errar(thrown, 'createUser_thrown', { invitation_id: invite.id });
    return { error: 'generic' };
  }

  // ── 5. El correo, lo último y solo si toca ─────────────────────────────────
  // Renovar la SUYA es un reenvío a mano pedido por alguien que está mirando la
  // pantalla, y sí manda. Lo que no manda es una fila nueva para un correo que ya
  // tenía otra pendiente: a una persona se le escribe una vez, y al aceptar el enlace
  // que ya tiene, `accept_pending_invitations` procesa TODAS las suyas del club.
  if (pendingCoversEmail(pendientesDelCorreo, { renewingId: pendiente?.id ?? null })) {
    trazar('covered_no_email', { invitation_id: invite.id });
    return { ok: { email, covered: true } };
  }

  const { error: mailErr, id: messageId } = await sendEmail({
    to: email,
    url,
    locale: emailLocale,
    role,
  });
  if (mailErr) {
    errar(mailErr, 'send_invite_email', { invitation_id: invite.id });
    return { error: 'generic' };
  }

  // A-2 — el correo ya ha salido: apuntar de qué envío es NO puede tumbarlo.
  await recordInvitationDelivery(
    admin,
    [invite.id],
    messageId,
    (err, step, extra) => errar(err, step, extra),
    'delivery_record_staff',
  );

  trazar('sent', { invitation_id: invite.id });
  return { ok: { email, covered: false } };
}
