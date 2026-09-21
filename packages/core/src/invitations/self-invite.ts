import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  isEmailAlreadyExistsError,
  type LinkInvitedUser,
  type LookupInviteRecipient,
  type SendInvitationEmail,
} from '../spectators/index';
import { inviteEmailMetadata } from './invite-email-metadata';

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
 * ⚠️ DUPLICACIÓN DELIBERADA. El bloque de envío + enlazado es casi idéntico al de
 * `performSpectatorInvite`, y así se queda. Unificarlo en un `inviteAndLink` estuvo
 * diseñado y aplazado desde el 2026-09-03, y el 2026-09-19 se RETIRÓ: los motivos,
 * y lo que sí se extrajo por el camino, están escritos en
 * `apps/web/src/lib/link-invited-user.ts`.
 *
 * En corto: estos senders son el alta de todos los usuarios, CI no ejercita el envío
 * y una regresión solo se ve cuando un padre no entra. Y el guard de censo
 * (`scripts/check-invite-senders.mjs`) cuenta llamadas LITERALES por fichero, así que
 * esconder el envío tras un helper común lo dejaría ciego: un sender futuro no
 * aparecería en ningún censo, que es justo el fallo histórico. Extraer obliga a
 * rediseñar ANTES cómo se vigila.
 *
 * Este es el sender nº 8, declarado en los dos censos.
 *
 * CORREO-B2 — migrado a Resend, igual que el 7 (Correo-B1) y por las mismas razones:
 * la cuenta se crea con `createUser` (que no manda correo) y el correo lo manda el
 * puerto `sendEmail` en el idioma del destinatario. Aquí ese idioma importa de una
 * forma que no se ve a simple vista: la cuenta del menor suele llevar el correo del
 * PADRE (por eso los borrados de tutores van por uuid y nunca filtrando por email),
 * así que muy a menudo el destinatario ya tiene perfil y hay un `locale` suyo que
 * respetar.
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
  args: { playerId: string; email: string; linkBase: string; locale: string },
  /** Obligatorio: no se puede crear la cuenta sin traer el enlazado. Ver `LinkInvitedUser`. */
  link: LinkInvitedUser,
  /** Obligatorio: sin él habría invitación y cuenta, y nadie avisado. Ver `SendInvitationEmail`. */
  sendEmail: SendInvitationEmail,
  /** Obligatorio: sin él, reenviar una invitación sin reclamar deja al menor fuera. Ver `LookupInviteRecipient`. */
  lookup: LookupInviteRecipient,
  logError?: SelfInviteLogger
): Promise<SelfInviteResult> {
  const { playerId, email, linkBase, locale } = args;
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

  const url = `${linkBase}/${invite.token}`;

  // 2) ¿QUIÉN ES EL DESTINATARIO? Antes de crear nada: decide si hay cuenta que
  // crear, cuál enlazar y en qué idioma escribir (Correo-B2, ver el puerto).
  let found: Awaited<ReturnType<LookupInviteRecipient>> = null;
  try {
    found = await lookup(email);
  } catch (thrown) {
    log(thrown, 'lookup_recipient_self_thrown', { invitation_id: invite.id });
  }

  const emailLocale = found?.locale ?? locale;

  // 3) CUENTA con ADMIN — SOLO tras crear la invitación (los gates ya pasaron).
  let existing = false;
  try {
    if (found && !found.invitePending) {
      // Cuenta de verdad, suya. No se crea ni se enlaza nada: acepta con su sesión.
      // Aquí esto es MÁS común que en seguidores: la cuenta del menor suele llevar
      // el correo del padre, que casi siempre ya tiene cuenta.
      existing = true;
    } else if (found && found.invitePending) {
      // Cuenta que creamos y nadie reclamó: se ENLAZA ésa a la invitación nueva, no
      // se crea otra. Sin esto, un reenvío deja al menor con un formulario que le
      // pide una contraseña que nunca fijó (incidente de agosto de 2026).
      const linked = await link(invite.id, found.userId);
      if (!linked.ok) return { error: 'generic' };
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        // Su correo ES su prueba: el enlace le llega ahí. Sin esto GoTrue le niega el
        // login al fijar la contraseña en /invite (BUG-4).
        email_confirm: true,
        user_metadata: inviteEmailMetadata({
          invitationId: invite.id,
          kind: 'menor',
          locale: emailLocale,
        }),
      });

      if (createErr) {
        if (isEmailAlreadyExistsError(createErr)) {
          // La búsqueda dijo que no había cuenta y sí la hay: se trata como ajena
          // —lo conservador— y queda rastro.
          log(createErr, 'createUser_self_race', { invitation_id: invite.id });
          existing = true;
        } else {
          log(createErr, 'createUser_self', { invitation_id: invite.id });
          return { error: 'generic' };
        }
      } else {
        // Cuenta creada por NOSOTROS → hay que enlazar su auth.users.id.
        const invitedUserId = created?.user?.id ?? null;
        if (!invitedUserId) {
          log(
            new Error('createUser sin user.id (self)'),
            'invited_user_missing_id_self',
            { invitation_id: invite.id }
          );
          return { error: 'generic' };
        }
        // El puerto exige 1 fila afectada y reporta él mismo si falla.
        const linked = await link(invite.id, invitedUserId);
        if (!linked.ok) return { error: 'generic' };
      }
    }
  } catch (thrown) {
    log(thrown, 'createUser_self_thrown', { invitation_id: invite.id });
    return { error: 'generic' };
  }

  // 4) EL CORREO, lo último: con la invitación creada y la cuenta ya enlazada. Si
  // falla aquí no queda nada roto y reenviar vuelve a intentarlo.
  try {
    const { error: mailErr } = await sendEmail({ to: email, url, locale: emailLocale });
    if (mailErr) {
      log(mailErr, 'send_invite_email_self', { invitation_id: invite.id });
      return { error: 'generic' };
    }
  } catch (thrown) {
    log(thrown, 'send_invite_email_self_thrown', { invitation_id: invite.id });
    return { error: 'generic' };
  }

  return { ok: { email, existing } };
}
