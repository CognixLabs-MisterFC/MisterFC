/**
 * R-2 — el gate del endpoint público de aceptación de cuenta propia.
 *
 * `/api/invitations/self-accept` no tiene sesión: el token ES la credencial. Eso lo
 * hace el sitio más delicado del proyecto, y este módulo es su cerradura.
 *
 * POR QUÉ ESTÁ EN CORE Y NO EN EL HANDLER. Porque `apps/web` no tiene ni una prueba, y
 * un invariante que nadie puede poner rojo no es un invariante: es un comentario. Aquí
 * se puede, y hay una suite que lo hace.
 *
 * EL INVARIANTE, en una frase: este endpoint SOLO atiende el caso `set_password` de una
 * invitación `self`. Las otras dos ramas de `chooseInviteForm` no entran:
 *
 *   · `quick` — un usuario YA configurado aceptando una invitación adicional. Necesita
 *     sesión; por aquí no pasa.
 *   · `sign_in` — el correo ya tenía cuenta (`invited_user_id` nulo). ESTA es la que no
 *     puede entrar nunca. Atenderla significaría verificar una contraseña existente
 *     contra un endpoint sin autenticar: un ORÁCULO DE CONTRASEÑAS. Y en la otra
 *     dirección, dejar que el token FIJE la contraseña de una cuenta preexistente es el
 *     vector de secuestro que cerró Rework B.
 *
 * Y solo `self`. Una invitación de tutor trae datos del hijo y decisiones de imagen que
 * MN-3 reserva al tutor; no hay forma de darlas por buenas sin la pantalla que las pide.
 */

import { assertInvitationValid, type InvitationGateRow } from '../auth/invitation-token';

/** Por qué se niega el endpoint. Cada uno con nombre propio: el 404 genérico esconde bugs. */
export type SelfAcceptRefusal =
  | 'not_found'
  | 'already_accepted'
  | 'expired'
  | 'not_self'
  | 'not_claimable';

/** Lo que el gate necesita de la fila de invitación. */
export type SelfAcceptInvitation = {
  accepted_at: string | null;
  expires_at: string;
  email: string;
  player_relation: string | null;
  invited_user_id: string | null;
} | null;

export type SelfAcceptDecision =
  | { ok: { targetUid: string; email: string } }
  | { error: SelfAcceptRefusal };

/**
 * Decide si el endpoint público puede atender esta invitación.
 *
 * El orden importa y es el mismo que la página: primero el estado del token
 * (`assertInvitationValid`, que ya es de donde salen not_found/already_accepted/
 * expired y no se reescribe aquí), y solo después las dos condiciones propias del
 * endpoint.
 *
 * `wrong_email` no puede salir: no se pasa email de sesión porque no hay sesión.
 */
export function decideSelfAccept(
  invitation: SelfAcceptInvitation,
  nowMs: number,
): SelfAcceptDecision {
  const verdict = assertInvitationValid(invitation as InvitationGateRow, nowMs);
  if (verdict === 'not_found') return { error: 'not_found' };
  if (verdict === 'already_accepted') return { error: 'already_accepted' };
  if (verdict === 'expired') return { error: 'expired' };
  // `wrong_email` queda fuera por construcción (no se pasa authedEmail). Si algún día
  // entrara, cae en el not_found de abajo antes que colarse como válido.
  if (verdict !== 'valid' || !invitation) return { error: 'not_found' };

  // Solo cuenta propia del menor.
  if (invitation.player_relation !== 'self') return { error: 'not_self' };

  // Solo cuenta NO reclamada. Sin `invited_user_id` estaríamos en la rama `sign_in`.
  if (!invitation.invited_user_id) return { error: 'not_claimable' };

  return { ok: { targetUid: invitation.invited_user_id, email: invitation.email } };
}

/**
 * R-5 — el MISMO veredicto, para poder preguntarlo ANTES de pedir nada.
 *
 * POR QUÉ EXISTE, medido en producción el 2026-09-29 con una invitación de tutor real:
 * la pantalla nativa (`app/invite/[token].tsx`) atiende SOLO el caso `self`, pero la
 * ruta `/{locale}/invite/*` la reclaman las dos tiendas (`autoVerify` en Android y el
 * `apple-app-site-association` del dominio), así que CUALQUIER invitación abierta desde
 * el móvil aterriza ahí. Y el veredicto solo se calculaba dentro del POST, y además
 * DESPUÉS del esquema del cuerpo: un padre rellenaba nombre, teléfono y dos
 * consentimientos para recibir `not_self` al final y ser mandado al navegador.
 *
 * NO ES UN GATE NUEVO, y eso es todo el diseño: llama a `decideSelfAccept` y no
 * reimplementa ni una condición. Si fueran dos reglas, el día que una cambiara la
 * pantalla ofrecería lo que el POST rechaza — que es la misma clase de fallo que la
 * serie W estuvo cerrando.
 *
 * LO QUE NO DEJA SALIR. La rama `ok` del gate lleva `targetUid` y `email` porque el POST
 * los necesita para reclamar la cuenta. El preflight los TIRA: contesta un estado y nada
 * más. Es un endpoint público sin autenticar, y el token dice que quien lo tiene puede
 * ACEPTAR esa invitación, no que pueda leer a quién se invitó ni con qué cuenta. Lo fija
 * un test que cuenta las claves del objeto: si alguien añade el correo «para pintar un
 * saludo», se pone rojo.
 *
 * Y TAMPOCO DICE DE QUÉ TIPO ES. Para todo lo que no es `self` la respuesta es
 * `not_self`, sin distinguir tutor de seguidor: la pantalla hace lo mismo con todos
 * —decirlo y mandar al navegador— y un dato que nadie usa es un dato que solo puede
 * filtrarse.
 */
export type InvitePreflight = { status: 'self' } | { error: SelfAcceptRefusal };

export function decideInvitePreflight(
  invitation: SelfAcceptInvitation,
  nowMs: number,
): InvitePreflight {
  const decision = decideSelfAccept(invitation, nowMs);
  return 'error' in decision ? { error: decision.error } : { status: 'self' };
}
