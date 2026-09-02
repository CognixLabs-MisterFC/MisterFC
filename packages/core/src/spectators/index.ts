import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';
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
 * EL CASO DELICADO (F2): ¿el email ya es usuario de Supabase? `inviteUserByEmail`
 * falla entonces con `code === 'email_exists'` o, según versión de GoTrue, con un
 * mensaje "already been registered" / "already exists". Detectarlo bien es lo que
 * evita que el envío "reviente": en ese caso se reenvía por reset de contraseña.
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
 * Caso email-ya-existe → `existing: true` (reenvío por reset, como el usuario). La
 * web lo ignora; el endpoint nativo lo muestra. `logError` recibe cada fallo crudo
 * (core no importa Sentry).
 *
 * ENLAZADO (7º sender del censo, ver apps/web/src/lib/link-invited-user.ts): cuando
 * el email crea la cuenta, se enlaza su `auth.users.id` en `invitations.invited_user_id`
 * a través del puerto `link` (obligatorio). En el fallback "email ya existe" NO se
 * enlaza: la cuenta es del propio invitado y `invited_user_id` queda NULL por diseño.
 */
export async function performSpectatorInvite(
  userSupabase: DbClient,
  admin: DbClient,
  args: { playerId: string; email: string; linkBase: string },
  /** Obligatorio: no se puede enviar sin traer el enlazado. Ver `LinkInvitedUser`. */
  link: LinkInvitedUser,
  logError?: SpectatorInviteLogger
): Promise<SpectatorInviteResult> {
  const { playerId, email, linkBase } = args;
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

  const redirectTo = `${linkBase}/${invite.token}`;

  // 2) Email con ADMIN — SOLO tras crear la invitación (el gate ya pasó).
  let existing = false;
  try {
    const { data: inviteData, error: invErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { invite_pending: true, invitation_id: invite.id },
      });

    if (invErr) {
      if (isEmailAlreadyExistsError(invErr)) {
        // Ya es usuario → inviteUserByEmail no puede. Reenvío por reset (mismo
        // redirectTo), COMO EL USUARIO. La invitación ya existe → el accept se
        // completa igual.
        existing = true;
        const { error: resetErr } =
          await userSupabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (resetErr) {
          log(resetErr, 'reset_fallback_spectator', { invitation_id: invite.id });
          return { error: 'generic' };
        }
      } else {
        log(invErr, 'inviteUserByEmail_spectator', { invitation_id: invite.id });
        return { error: 'generic' };
      }
    } else {
      // Cuenta creada por NOSOTROS → hay que enlazar su auth.users.id. Única rama
      // donde nace la cuenta; el enlazado es incondicional aquí.
      const invitedUserId = inviteData?.user?.id ?? null;
      if (!invitedUserId) {
        // Invite OK pero sin user.id (#535): ruidoso + error, para que se reintente.
        log(
          new Error('inviteUserByEmail sin user.id (spectator)'),
          'invited_user_missing_id_spectator',
          { invitation_id: invite.id }
        );
        return { error: 'generic' };
      }
      // El puerto exige 1 fila afectada y reporta él mismo si falla (#540).
      const linked = await link(invite.id, invitedUserId);
      if (!linked.ok) return { error: 'generic' };
    }
  } catch (thrown) {
    log(thrown, 'inviteUserByEmail_spectator_thrown', {
      invitation_id: invite.id,
    });
    return { error: 'generic' };
  }

  return { ok: { email, existing } };
}
