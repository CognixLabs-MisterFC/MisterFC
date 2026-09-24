import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';
import { inviteEmailMetadata } from '../invitations/invite-email-metadata';
import { recordInvitationDelivery } from '../invitations/delivery';
import type { FollowedPlayer } from '../auth/spectator';

/**
 * O2-5 C1 — Seguidores (espectadores) de un jugador. Extraído de
 * `apps/web/.../mi-ficha/seguidores/page.tsx` (listado) y de la acción
 * `removeSpectatorForPlayer` (jugadores/actions.ts). El gate tutor/self lo imponen
 * los RPC SECURITY DEFINER (list_player_spectators / remove_spectator); aquí solo
 * se llama y se mapea. INVITAR no se extrae: su envío de email es server-only
 * (admin client) y no aplica a la app (C1: listar + revocar).
 */
type DbClient = SupabaseClient<Database>;

/** Fila del listado de seguidores (forma cruda del RPC list_player_spectators).
 * `full_name` y `email` son NULLABLE (así lo tipa el RPC vía database.overrides):
 * un seguidor invitado puede no haber completado su perfil. El tipo lo refleja para
 * que el consumidor esté OBLIGADO a manejar el null (no por casualidad de un `?.`). */
export type PlayerSpectator = {
  spectator_profile_id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
};

/**
 * O2-6 — Jugadores que SIGUE un seguidor (espectador), con sus datos DEPORTIVOS
 * (nombre + equipo activo). Extraído de `apps/web/lib/spectator-shell.ts`
 * (loadSpectatorContext) para que la app nativa monte su "jugador seguido activo".
 * La web pasa a delegar (comportamiento idéntico).
 *
 * SOLO datos deportivos: nombre/club por la vista `players_sporting` (F14C-3,
 * `players` está cerrada al seguidor), equipo activo por `team_members` (RLS
 * `is_spectator_of_players_club`). La RLS acota a las filas propias del seguidor.
 * Orden estable por nombre (mismo criterio que la web).
 */
export async function getFollowedPlayersFromClient(
  supabase: DbClient,
  userId: string
): Promise<FollowedPlayer[]> {
  // Jugadores seguidos: player_spectators (RLS: solo filas propias del seguidor).
  const { data: links } = await supabase
    .from('player_spectators')
    .select('player_id')
    .eq('spectator_profile_id', userId);
  const playerIds = (links ?? []).map((l) => l.player_id);
  if (playerIds.length === 0) return [];

  // Nombre + club por la vista deportiva (nada personal).
  const { data: sportRows } = await supabase
    .from('players_sporting')
    .select('id, club_id, first_name, last_name')
    .in('id', playerIds);

  // Equipo ACTIVO de cada jugador: team_members (RLS abierta al seguidor por
  // is_spectator_of_players_club) + nombre del equipo desde teams.
  const { data: tmRows } = await supabase
    .from('team_members')
    .select('player_id, team_id')
    .in('player_id', playerIds)
    .is('left_at', null);
  const teamOfPlayer = new Map<string, string>();
  for (const r of tmRows ?? []) {
    if (!teamOfPlayer.has(r.player_id)) teamOfPlayer.set(r.player_id, r.team_id);
  }
  const teamIds = [...new Set([...teamOfPlayer.values()])];
  const teamNameById = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', teamIds);
    for (const tRow of teamRows ?? []) teamNameById.set(tRow.id, tRow.name);
  }

  return (sportRows ?? [])
    .filter((p): p is typeof p & { id: string } => p.id != null)
    .map((p) => {
      const teamId = teamOfPlayer.get(p.id) ?? null;
      const fullName =
        [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
      return {
        playerId: p.id,
        clubId: p.club_id ?? '',
        fullName,
        teamId,
        teamName: teamId ? (teamNameById.get(teamId) ?? null) : null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getPlayerSpectatorsFromClient(
  supabase: DbClient,
  playerId: string
): Promise<PlayerSpectator[]> {
  const { data } = await supabase.rpc('list_player_spectators', {
    p_player_id: playerId,
  });
  // Sin cast: la forma del RPC (con nullability correcta vía database.overrides) ya
  // encaja en PlayerSpectator. Antes `as PlayerSpectator[]` ocultaba que full_name/
  // email son nullable (el patrón que causó el 500 de producción).
  return data ?? [];
}

export type RemoveSpectatorResult =
  | { ok: true }
  | { error: 'forbidden' }
  | { error: 'generic'; raw: unknown };

/**
 * Revoca un seguidor de un jugador vía RPC `remove_spectator` (gate tutor/self en
 * la DB). Mapea el error a forbidden/generic; en generic devuelve el error crudo
 * (`raw`) para que el caller lo registre (web: Sentry). Escritura → write-guard en
 * el caller nativo.
 */
export async function removeSpectatorFromClient(
  supabase: DbClient,
  playerId: string,
  spectatorProfileId: string
): Promise<RemoveSpectatorResult> {
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { error: 'forbidden' };

  const { error } = await supabase.rpc('remove_spectator', {
    p_player_id: playerId,
    p_spectator_profile_id: spectatorProfileId,
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('forbidden') || msg.includes('no_session')) {
      return { error: 'forbidden' };
    }
    return { error: 'generic', raw: error };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// O2-5 F2 — Invitar seguidor (orquestación compartida web/nativo)
// ─────────────────────────────────────────────────────────────────────────────

export type SpectatorInviteResult =
  | { ok: { email: string; existing: boolean } }
  | { error: 'forbidden' | 'email_invalid' | 'generic' };

/** Sumidero de errores para el caller (web: Sentry). Core no depende de Sentry. */
export type SpectatorInviteLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>
) => void;

/**
 * PUERTO DE ENLAZADO — lo inyecta el caller (web: `linkInvitedUser`, que exige que
 * el UPDATE afecte exactamente 1 fila y reporta a Sentry si no).
 *
 * Es OBLIGATORIO a propósito: quien llame a `inviteUserByEmail` y cree la cuenta
 * DEBE enlazar después `invitations.invited_user_id`, y aquí eso lo garantiza el
 * compilador — no hay forma de invocar el envío sin traer el enlazado. Sin el
 * enlazado, `chooseInviteForm` no puede enrutar al form `set_password` por id y el
 * invitado cae en la trampa del incidente de agosto de 2026 (lo tapa el cinturón
 * de #539, pero se pierde el enlace).
 *
 * El puerto es responsable de SU PROPIO reporte de errores: si devuelve
 * `{ ok: false }`, ya lo ha registrado; aquí solo se corta y se devuelve 'generic'
 * al caller (así el guard vive en UN solo sitio, en apps/web, sin duplicarlo aquí
 * ni arrastrar Sentry a core).
 */
export type LinkInvitedUser = (
  invitationId: string,
  invitedUserId: string
) => Promise<{ ok: boolean }>;

/**
 * PUERTO DE CORREO (Correo-B1) — lo inyecta el caller (web:
 * `sendSpectatorInviteEmail`, que resuelve el idioma del destinatario, compone el
 * correo con el catálogo de next-intl y lo manda por Resend).
 *
 * Antes no hacía falta: el correo lo mandaba GoTrue como efecto secundario de
 * `inviteUserByEmail`, y por eso salía siempre en castellano —una plantilla única en
 * el dashboard de Supabase, que no puede leer `profiles.locale`—. Ahora la cuenta se
 * crea con `createUser`, que NO manda nada, y el correo lo manda quien sí sabe en qué
 * idioma escribir.
 *
 * Es OBLIGATORIO por la misma razón que el de enlazado: sin él, `createUser` dejaría
 * una cuenta creada y a nadie avisado — una invitación que existe y que su
 * destinatario no recibe jamás. El compilador impide llegar ahí.
 *
 * Como el de enlazado, es responsable de SU PROPIO reporte: si devuelve error, aquí
 * solo se corta con 'generic'.
 */
export type SendInvitationEmail = (args: {
  /** Destinatario. */
  to: string;
  /** Enlace de la invitación: `${linkBase}/${token}`. El token ES la credencial. */
  url: string;
  /** Idioma YA resuelto en el que hay que escribirle. */
  locale: string;
  //
  // A-2 — devuelve además el `id` que Resend da a ESE envío: es lo único que casa el
  // webhook de entrega con la fila, y sin él la invitación sale muda (si rebota, nadie
  // se entera). Es OPCIONAL a propósito: un envío puede salir bien y el id no llegar a
  // leerse, y eso no es motivo para tumbar una invitación que ya ha salido.
}) => Promise<{ error: unknown | null; id?: string }>;

/**
 * PUERTO DE BÚSQUEDA DEL DESTINATARIO (Correo-B1) — ¿este correo ya tiene cuenta?
 *
 * Existe por un agujero que se abre al dejar de usar `inviteUserByEmail`, y conviene
 * que quede escrito porque es sutil:
 *
 * GoTrue, al invitar a una dirección que ya tenía una cuenta creada por otra
 * invitación SIN RECLAMAR, la reinvitaba y devolvía su id, así que el sender la
 * enlazaba y todo seguía funcionando. `createUser` no hace eso: falla con
 * `email_exists` y no devuelve id. Sin este puerto, REENVIAR una invitación a alguien
 * que nunca la aceptó dejaría la fila nueva con `invited_user_id` en NULL, y al
 * entrar por el enlace `chooseInviteForm` le pediría iniciar sesión con una
 * contraseña que nunca fijó. Es exactamente la trampa del incidente de agosto de 2026.
 *
 * Por eso se mira ANTES de crear, y la respuesta distingue las dos cuentas que no se
 * parecen en nada:
 *   · `invitePending: true`  → cuenta que creamos nosotros y que nadie ha reclamado.
 *     No se crea otra: se ENLAZA ésta. Para el invitado sigue siendo su primera vez.
 *   · `invitePending: false` → cuenta de verdad, suya. No se toca ni se enlaza, y
 *     recibe el correo para aceptar con su propia sesión.
 *
 * Y de paso trae `locale`, que es lo que hace falta para escribirle en su idioma: si
 * ya es de la casa, el suyo; si no hay perfil, el de quien invita.
 */
export type LookupInviteRecipient = (email: string) => Promise<{
  userId: string;
  /** `user_metadata.invite_pending`: cuenta creada por invitación y sin reclamar. */
  invitePending: boolean;
  /** `profiles.locale` del destinatario, o null si no tiene perfil. */
  locale: string | null;
} | null>;

/**
 * EL CASO DELICADO (F2): ¿el email ya es usuario de Supabase? La creación de la
 * cuenta falla entonces con `code === 'email_exists'` o, según versión de GoTrue, con
 * un mensaje "already been registered" / "already exists". Detectarlo bien es lo que
 * separa los dos caminos buenos del error de verdad: si ya tiene cuenta, no se crea
 * nada y el correo sale igual (Correo-B1; antes salía un magic link).
 */
export function isEmailAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as { code?: unknown }).code === 'email_exists') return true;
  const msg = String((err as { message?: unknown }).message ?? '').toLowerCase();
  return (
    msg.includes('already been registered') || msg.includes('already exists')
  );
}

/**
 * Crea la invitación de SEGUIDOR y envía el email. Orquestación única compartida por
 * la Server Action web (cookie) y el route handler nativo (bearer).
 *
 * ORDEN = GARANTÍA DE SEGURIDAD:
 *   1. `invite_spectator` (RPC SECURITY DEFINER) se llama con `userSupabase` (cliente
 *      RLS del usuario). Su gate tutor/self corre ANTES del INSERT → no-tutor no crea
 *      invitación (→ 'forbidden'). NUNCA se llama con admin.
 *   2. Solo tras crear la invitación se usa `admin` (service-role) para el email.
 *
 * Caso email-ya-existe → `existing: true`: no se crea cuenta y el correo sale igual.
 * La web lo ignora; el endpoint nativo lo muestra. `logError` recibe cada fallo crudo
 * (core no importa Sentry).
 *
 * ENLAZADO (7º sender del censo, ver apps/web/src/lib/link-invited-user.ts): cuando
 * el email crea la cuenta, se enlaza su `auth.users.id` en `invitations.invited_user_id`
 * a través del puerto `link` (obligatorio). En el camino "email ya existe" NO se
 * enlaza: la cuenta es del propio invitado y `invited_user_id` queda NULL por diseño.
 *
 * CORREO-B1 — la cuenta se crea con `createUser` y el correo lo manda el puerto
 * `sendEmail`, en el idioma del destinatario. Antes lo mandaba GoTrue dentro de
 * `inviteUserByEmail`, siempre en castellano; hacer las dos cosas a la vez habría
 * mandado DOS correos, así que se separan: `createUser` no envía nada.
 *
 * El correo va SIEMPRE EL ÚLTIMO, y no por gusto: si se manda antes de que la
 * invitación esté enlazada, el destinatario puede llegar a `/invite` mientras la fila
 * todavía no apunta a su cuenta, que es exactamente la trampa del incidente de agosto
 * de 2026. Un correo que no sale se reintenta; una invitación rota, no.
 */
export async function performSpectatorInvite(
  userSupabase: DbClient,
  admin: DbClient,
  args: { playerId: string; email: string; linkBase: string; locale: string },
  /** Obligatorio: no se puede crear la cuenta sin traer el enlazado. Ver `LinkInvitedUser`. */
  link: LinkInvitedUser,
  /** Obligatorio: sin él habría invitación y cuenta, y nadie avisado. Ver `SendInvitationEmail`. */
  sendEmail: SendInvitationEmail,
  /** Obligatorio: sin él, reenviar una invitación sin reclamar deja al invitado fuera. Ver `LookupInviteRecipient`. */
  lookup: LookupInviteRecipient,
  logError?: SpectatorInviteLogger
): Promise<SpectatorInviteResult> {
  const { playerId, email, linkBase, locale } = args;
  const log: SpectatorInviteLogger = logError ?? (() => {});

  // 1) RPC COMO EL USUARIO — el gate tutor/self vive dentro (antes del INSERT).
  const { data: invite, error: rpcErr } = await userSupabase
    .rpc('invite_spectator', { p_player_id: playerId, p_email: email })
    .single();

  if (rpcErr) {
    const msg = rpcErr.message?.toLowerCase() ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('invalid_email')) return { error: 'email_invalid' };
    log(rpcErr, 'invite_spectator', { player_id: playerId });
    return { error: 'generic' };
  }
  if (!invite) return { error: 'generic' };

  const url = `${linkBase}/${invite.token}`;

  // 2) ¿QUIÉN ES EL DESTINATARIO? Se mira ANTES de crear nada (ver
  // `LookupInviteRecipient`): decide si hay que crear cuenta, cuál enlazar y en qué
  // idioma escribir. Si la búsqueda falla, no se corta el envío: se sigue como si no
  // tuviera cuenta —que es el caso normal— y `createUser` dirá la verdad.
  let found: Awaited<ReturnType<LookupInviteRecipient>> = null;
  try {
    found = await lookup(email);
  } catch (thrown) {
    log(thrown, 'lookup_recipient_spectator_thrown', { invitation_id: invite.id });
  }

  // El idioma del destinatario manda; si no tiene perfil, el de quien invita.
  const emailLocale = found?.locale ?? locale;

  // 3) CUENTA con ADMIN — SOLO tras crear la invitación (el gate ya pasó).
  //
  // `createUser` y no `inviteUserByEmail` (Correo-B1): el segundo manda su propio
  // correo, siempre en castellano, y sumado al nuestro serían dos. Este no manda
  // nada. Lo demás no cambia: la cuenta nace con el mismo `user_metadata`
  // —`invitation_id` incluido, que es lo que exige `handle_new_user` desde F14D— y
  // se enlaza igual.
  //
  // `email_confirm: true` porque el correo del invitado ES su prueba: le llega a esa
  // dirección. Sin eso, GoTrue le negaría el login al fijar la contraseña en
  // `/invite` (fue exactamente el BUG-4).
  let existing = false;
  try {
    if (found && !found.invitePending) {
      // Cuenta suya, de verdad. No se crea ni se enlaza nada: `invited_user_id`
      // queda NULL por diseño y acepta con su propia sesión.
      existing = true;
    } else if (found && found.invitePending) {
      // Cuenta que creamos y nadie reclamó: NO se crea otra, se enlaza ÉSTA a la
      // invitación nueva. Sin esto, un simple reenvío dejaría al invitado pidiéndole
      // una contraseña que nunca fijó (incidente de agosto de 2026).
      const linked = await link(invite.id, found.userId);
      if (!linked.ok) return { error: 'generic' };
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: inviteEmailMetadata({
          invitationId: invite.id,
          kind: 'seguidor',
          locale: emailLocale,
        }),
      });

      if (createErr) {
        if (isEmailAlreadyExistsError(createErr)) {
          // La búsqueda dijo que no había cuenta y sí la hay: o se creó entre medias,
          // o la búsqueda falló. Se trata como cuenta ajena —lo conservador— y se
          // deja rastro, porque significa que el invitado puede necesitar ayuda.
          log(createErr, 'createUser_spectator_race', { invitation_id: invite.id });
          existing = true;
        } else {
          log(createErr, 'createUser_spectator', { invitation_id: invite.id });
          return { error: 'generic' };
        }
      } else {
        // Cuenta creada por NOSOTROS → hay que enlazar su auth.users.id. Única rama
        // donde nace la cuenta; el enlazado es incondicional aquí.
        const invitedUserId = created?.user?.id ?? null;
        if (!invitedUserId) {
          // Creación OK pero sin user.id (#535): ruidoso + error, para que se reintente.
          log(
            new Error('createUser sin user.id (spectator)'),
            'invited_user_missing_id_spectator',
            { invitation_id: invite.id }
          );
          return { error: 'generic' };
        }
        // El puerto exige 1 fila afectada y reporta él mismo si falla (#540).
        const linked = await link(invite.id, invitedUserId);
        if (!linked.ok) return { error: 'generic' };
      }
    }
  } catch (thrown) {
    log(thrown, 'createUser_spectator_thrown', {
      invitation_id: invite.id,
    });
    return { error: 'generic' };
  }

  // 4) EL CORREO, lo último: con la invitación creada y la cuenta ya enlazada. Si
  // fallara aquí, no queda nada roto —invitación y cuenta están bien— y reenviar la
  // invitación vuelve a intentarlo.
  try {
    const { error: mailErr, id: messageId } = await sendEmail({
      to: email,
      url,
      locale: emailLocale,
    });
    if (mailErr) {
      log(mailErr, 'send_invite_email_spectator', { invitation_id: invite.id });
      return { error: 'generic' };
    }
    // A-2 — el correo ya ha salido: apuntar de qué envío es NO puede tumbarlo. Ver la
    // nota de `recordInvitationDelivery`.
    await recordInvitationDelivery(
      admin,
      [invite.id],
      messageId,
      log,
      'delivery_record_spectator',
    );
  } catch (thrown) {
    log(thrown, 'send_invite_email_spectator_thrown', { invitation_id: invite.id });
    return { error: 'generic' };
  }

  return { ok: { email, existing } };
}
