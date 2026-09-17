import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  isEmailAlreadyExistsError,
  type LinkInvitedUser,
} from '../spectators/index';

/**
 * MN-5 — el TUTOR invita a su hijo a tener cuenta propia.
 *
 * Orquestación única compartida por la Server Action web (cookie) y el route
 * handler nativo (bearer), calcada de `performSpectatorInvite`: es el mismo
 * problema —una familia crea una invitación y hay que mandar el correo— y por
 * tanto el mismo orden, que es el que da la garantía:
 *
 *   1. `invite_player_self` (RPC SECURITY DEFINER) se llama con `userSupabase`
 *      (cliente RLS del usuario). Sus gates corren ANTES del INSERT → quien no es
 *      tutor de ese jugador no crea invitación. NUNCA se llama con admin.
 *   2. Solo tras crear la invitación se usa `admin` (service-role) para el email.
 *
 * ⚠️ DUPLICACIÓN DELIBERADA, y no es decisión de este PR. El bloque de envío +
 * enlazado es casi idéntico al de `performSpectatorInvite`. Unificarlo en un
 * `inviteAndLink` está DISEÑADO Y APLAZADO desde el 2026-09-03: la decisión, sus
 * motivos y hasta el orden de adopción están escritos en
 * `apps/web/src/lib/link-invited-user.ts`. En corto: estos senders son el alta de
 * todos los usuarios, CI no ejercita el envío (necesita GoTrue) y una regresión solo
 * se ve cuando un padre no entra. La regla que fijó aquella decisión es «migrar un
 * sender por PR, con verificación manual de sus tres estados», y desde luego no
 * «de paso» mientras se construye otra cosa.
 *
 * Hay además un motivo que el aplazamiento no menciona y conviene tener presente:
 * el guard de censo (`scripts/check-invite-senders.mjs`) cuenta llamadas LITERALES
 * a `auth.admin.inviteUserByEmail(` por fichero. Esconder el envío tras un helper
 * común lo dejaría ciego — un sender futuro no aparecería en ningún censo —, así
 * que extraer obliga a rediseñar a la vez cómo se vigila. No es un refactor neutro.
 *
 * Este es el sender nº 8, declarado en los dos censos.
 */

type DbClient = SupabaseClient<Database>;

export type SelfInviteError =
  /** Quien llama no es tutor (parent/guardian) de ese jugador. */
  | 'forbidden'
  /** El jugador está borrado por RGPD. */
  | 'erased'
  /** Ese jugador ya tiene cuenta propia. */
  | 'already_linked'
  /** La dirección ya figura como tutor de ese jugador (MN-4). */
  | 'email_relation_conflict'
  /** Faltan las decisiones de imagen de la temporada activa (MN-2). */
  | 'consents_required'
  /** El club no tiene temporada activa. */
  | 'no_active_season'
  | 'email_invalid'
  | 'generic';

export type SelfInviteResult =
  | { error: SelfInviteError }
  | { ok: { email: string; existing: boolean } };

export type SelfInviteLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>
) => void;

/**
 * Los gates de la RPC, mapeados de uno en uno. Se comprueban por `includes` sobre el
 * mensaje porque es como llegan los `raise exception` de plpgsql a PostgREST, igual
 * que en el resto de las acciones del proyecto.
 *
 * `no_session` NO se mapea: si no hay sesión no se llega hasta aquí (la acción y el
 * route handler lo cortan antes), y confundirlo con un gate de negocio haría pensar
 * en un permiso donde solo hay una sesión caducada.
 */
function mapRpcError(message: string): SelfInviteError {
  const msg = message.toLowerCase();
  if (msg.includes('forbidden')) return 'forbidden';
  if (msg.includes('erased')) return 'erased';
  if (msg.includes('already_linked')) return 'already_linked';
  if (msg.includes('email_relation_conflict')) return 'email_relation_conflict';
  if (msg.includes('consents_required')) return 'consents_required';
  if (msg.includes('no_active_season')) return 'no_active_season';
  if (msg.includes('invalid_email')) return 'email_invalid';
  return 'generic';
}

export async function performSelfInvite(
  userSupabase: DbClient,
  admin: DbClient,
  args: { playerId: string; email: string; linkBase: string },
  /** Obligatorio: no se puede enviar sin traer el enlazado. Ver `LinkInvitedUser`. */
  link: LinkInvitedUser,
  logError?: SelfInviteLogger
): Promise<SelfInviteResult> {
  const { playerId, email, linkBase } = args;
  const log: SelfInviteLogger = logError ?? (() => {});

  // 1) RPC COMO EL USUARIO — los gates viven dentro, antes del INSERT.
  const { data: invite, error: rpcErr } = await userSupabase
    .rpc('invite_player_self', { p_player_id: playerId, p_email: email })
    .single();

  if (rpcErr) {
    const mapped = mapRpcError(rpcErr.message ?? '');
    // Los gates son respuestas esperadas del negocio, no incidencias: solo se
    // reporta lo que no sabemos explicar.
    if (mapped === 'generic') {
      log(rpcErr, 'invite_player_self', { player_id: playerId });
    }
    return { error: mapped };
  }
  if (!invite) return { error: 'generic' };

  const redirectTo = `${linkBase}/${invite.token}`;

  // 2) Email con ADMIN — SOLO tras crear la invitación (los gates ya pasaron).
  let existing = false;
  try {
    const { data: inviteData, error: invErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { invite_pending: true, invitation_id: invite.id },
      });

    if (invErr) {
      if (isEmailAlreadyExistsError(invErr)) {
        // Ya es usuario → `inviteUserByEmail` no puede. Reenvío por reset (mismo
        // redirectTo), COMO EL USUARIO. La invitación ya existe → el accept se
        // completa igual.
        existing = true;
        const { error: resetErr } =
          await userSupabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (resetErr) {
          log(resetErr, 'reset_fallback_self', { invitation_id: invite.id });
          return { error: 'generic' };
        }
      } else {
        log(invErr, 'inviteUserByEmail_self', { invitation_id: invite.id });
        return { error: 'generic' };
      }
    } else {
      // Cuenta creada por NOSOTROS → hay que enlazar su auth.users.id.
      const invitedUserId = inviteData?.user?.id ?? null;
      if (!invitedUserId) {
        log(
          new Error('inviteUserByEmail sin user.id (self)'),
          'invited_user_missing_id_self',
          { invitation_id: invite.id }
        );
        return { error: 'generic' };
      }
      // El puerto exige 1 fila afectada y reporta él mismo si falla.
      const linked = await link(invite.id, invitedUserId);
      if (!linked.ok) return { error: 'generic' };
    }
  } catch (thrown) {
    log(thrown, 'inviteUserByEmail_self_thrown', { invitation_id: invite.id });
    return { error: 'generic' };
  }

  return { ok: { email, existing } };
}
