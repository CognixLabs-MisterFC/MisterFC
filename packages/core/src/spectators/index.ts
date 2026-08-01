import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';

/**
 * O2-5 C1 — Seguidores (espectadores) de un jugador. Extraído de
 * `apps/web/.../mi-ficha/seguidores/page.tsx` (listado) y de la acción
 * `removeSpectatorForPlayer` (jugadores/actions.ts). El gate tutor/self lo imponen
 * los RPC SECURITY DEFINER (list_player_spectators / remove_spectator); aquí solo
 * se llama y se mapea. INVITAR no se extrae: su envío de email es server-only
 * (admin client) y no aplica a la app (C1: listar + revocar).
 */
type DbClient = SupabaseClient<Database>;

/** Fila del listado de seguidores (forma cruda del RPC list_player_spectators). */
export type PlayerSpectator = {
  spectator_profile_id: string;
  full_name: string;
  email: string;
  created_at: string;
};

export async function getPlayerSpectatorsFromClient(
  supabase: DbClient,
  playerId: string
): Promise<PlayerSpectator[]> {
  const { data } = await supabase.rpc('list_player_spectators', {
    p_player_id: playerId,
  });
  return (data ?? []) as PlayerSpectator[];
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
 */
export async function performSpectatorInvite(
  userSupabase: DbClient,
  admin: DbClient,
  args: { playerId: string; email: string; linkBase: string },
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
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
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
    }
  } catch (thrown) {
    log(thrown, 'inviteUserByEmail_spectator_thrown', {
      invitation_id: invite.id,
    });
    return { error: 'generic' };
  }

  return { ok: { email, existing } };
}
