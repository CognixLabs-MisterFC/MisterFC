import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { isSamePasswordError } from '../auth/index';
import type { AcceptInvitationWithProfileInput } from '../schemas/auth';

type Sb = SupabaseClient<Database>;

/**
 * R-1 — El alta del INVITADO NUEVO, sacada de la Server Action de la web.
 *
 * POR QUÉ SE MUEVE. La pantalla nativa de invitación (R-3) tiene que hacer lo
 * mismo que la web: fijar la contraseña de la cuenta no reclamada, iniciar sesión
 * con ella, escribir el perfil y aceptar el lote. Escribirlo dos veces es el
 * pecado contra el que lleva toda esta serie —y aquí sería peor que en otros
 * sitios, porque por este camino entran tutores, cuerpo técnico y entrenadores,
 * no solo el menor con cuenta propia.
 *
 * QUÉ SE MUEVE Y QUÉ NO. Aquí vive lo que las dos superficies necesitan igual:
 *
 *   claimInviteeAccount            contraseña → sesión → perfil
 *   acceptPendingInvitationsFromClient   la RPC del lote y el MAPEO de su error
 *
 * Lo que NO se mueve porque es de la web y solo de la web: la subida de imágenes
 * de los hijos, la persistencia de sus datos confirmados y el aviso a dirección
 * cuando quien acepta es entrenador. Esas tres siguen en `attachAllPending`,
 * alrededor de la llamada de aquí.
 *
 * EL CLIENTE LO PONE EL LLAMADOR, y es lo que permite que sirva para las dos: la
 * web pasa el cliente con adaptador de cookies (la sesión se persiste sola) y la
 * nativa pasará uno normal, cuya sesión se queda en memoria y se devuelve al
 * dispositivo. `signInWithPassword` deja la sesión EN EL CLIENTE en los dos
 * casos, así que el `profiles.update` y la RPC que vienen después corren ya con
 * la identidad del invitado — que es justo lo que exige el guard de la RPC
 * (`auth.uid()` ↔ email de la invitación).
 *
 * ORDEN Y CÓDIGOS SE CONSERVAN LETRA POR LETRA. Esto es una extracción, no una
 * mejora: los mismos pasos, en el mismo orden, con los mismos nombres de error.
 * Lo que haya que arreglar se arregla después y con su propio motivo.
 */

/** Los errores que producen las dos funciones de este módulo. */
export type InviteAcceptError =
  | 'auth_update_failed'
  | 'sign_in_failed'
  | 'profile_update_failed'
  | 'account_deletion_in_progress'
  | 'consent_required'
  | 'wrong_email'
  | 'not_found'
  | 'no_session'
  | 'image_decision_required'
  | 'image_required'
  | 'reserved_for_tutor'
  /**
   * Mig 20261099000000: quien acepta CONSTA menor de edad y el alta lo convertiría
   * en tutor. Tiene código propio porque sin él cae en 'generic' y el mensaje manda
   * a mirar al sitio equivocado — que es exactamente lo que costó encontrar el
   * BUG-4 de la contraseña.
   */
  | 'tutor_menor_de_edad'
  | 'generic';

/** Sumidero de errores del llamador (web: Sentry). Core no importa Sentry. */
export type InviteAcceptLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;

const noopLog: InviteAcceptLogger = () => {};

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Reclamar la cuenta: contraseña → sesión → perfil
// ─────────────────────────────────────────────────────────────────────────────

export type ClaimInviteeAccountOutcome =
  | { ok: { userId: string } }
  | { error: 'auth_update_failed' | 'sign_in_failed' | 'profile_update_failed' };

/**
 * Fija la contraseña sobre la cuenta NO RECLAMADA, crea la sesión con ella y
 * escribe el perfil.
 *
 * `targetUid` lo resuelve el llamador a propósito: la web tiene un cinturón
 * anti-trampa —recuperar la cuenta de la sesión del magic link cuando el enlazado
 * falló al enviar— que depende de su propia sesión y no tiene sentido en nativa,
 * donde no hay ninguna sesión antes de esto.
 */
export async function claimInviteeAccount(
  userSupabase: Sb,
  admin: Sb,
  args: {
    targetUid: string;
    email: string;
    locale: string;
    profile: AcceptInvitationWithProfileInput;
  },
  logError: InviteAcceptLogger = noopLog,
): Promise<ClaimInviteeAccountOutcome> {
  const { targetUid, email, locale, profile } = args;

  // `invite_pending: false` TAMBIÉN en user_metadata (GoTrue FUSIONA, no
  // reemplaza): es el bucket que lee el gate de la pantalla. Sin esto quedaba
  // stale=true y un usuario ya configurado, al aceptar una invitación adicional,
  // se iba otra vez a poner contraseña.
  //
  // Y la fecha de nacimiento SOLO SI VIENE. Desde que la pantalla web dejó de
  // pedírsela al tutor, aquí llega `null` en ese flujo — y un `null` en
  // `user_metadata` no deja el valor como estaba: GoTrue fusiona, así que BORRA la
  // clave. Escribirla siempre significaría vaciar la fecha que el perfil ya tuviera.
  // La sigue enviando la pantalla NATIVA del caso `self`, donde es la del propio
  // jugador.
  const metadata = {
    user_metadata: {
      full_name: profile.full_name,
      ...(profile.date_of_birth ? { date_of_birth: profile.date_of_birth } : {}),
      locale,
      invite_pending: false,
    },
    app_metadata: { invite_pending: false },
  };

  const { error: updErr } = await admin.auth.admin.updateUserById(targetUid, {
    password: profile.password,
    // BUG-4 — SE CONFIRMA EL CORREO AQUÍ, y no es un atajo: es reponer lo que BUG-3 se
    // llevó por delante sin que se notara.
    //
    // La cuenta del invitado nace por `inviteUserByEmail` con el correo SIN confirmar, y
    // quien la confirmaba era el `/auth/v1/verify` de Supabase, por el que pasaba el
    // enlace del correo cuando la plantilla usaba `{{ .ConfirmationURL }}`. BUG-3 la
    // cambió a `{{ .RedirectTo }}` para que los enlaces profundos se verificaran contra
    // misterfc.es —sin eso la app no se abría nunca—, y con ello el enlace dejó de tocar
    // el verify. Resultado: correo sin confirmar para siempre, y GoTrue RECHAZA el
    // inicio de sesión por contraseña de una cuenta sin confirmar.
    //
    // Medido en producción: 21 cuentas, 17 han entrado alguna vez, CERO lo han hecho sin
    // el correo confirmado. Y el caso real: contraseña fijada a las 21:39:21,
    // `last_sign_in_at` nulo, invitación sin aceptar.
    //
    // Confirmarlo aquí es legítimo con el mismo argumento que sostiene todo Rework B: el
    // token viaja ÚNICAMENTE por correo, así que presentarlo ya prueba el control del
    // buzón. Es exactamente lo que certificaba el verify, por otro camino.
    email_confirm: true,
    ...metadata,
  });
  if (updErr && !isSamePasswordError(updErr)) {
    logError(updErr, 'claim_set_password', { target_uid: targetUid });
    return { error: 'auth_update_failed' };
  }
  if (updErr) {
    // La contraseña ya era esa (re-claim idempotente): aseguramos la metadata sin
    // tocarla. Un doble envío no puede dejar el alta a medias.
    await admin.auth.admin.updateUserById(targetUid, metadata);
  }

  const { data: signInData, error: signInErr } =
    await userSupabase.auth.signInWithPassword({ email, password: profile.password });
  const user = signInData?.user ?? null;
  if (signInErr || !user) {
    logError(signInErr ?? new Error('no user after sign-in'), 'claim_sign_in', {
      target_uid: targetUid,
    });
    // CÓDIGO PROPIO, no `auth_update_failed`. Los dos pasos compartían código y el
    // usuario leía «no hemos podido establecer tu contraseña» cuando la contraseña se
    // había fijado perfectamente y lo que fallaba era entrar. Ese mensaje mandó a mirar
    // al sitio equivocado durante toda la investigación de este fallo: costó más
    // encontrarlo que arreglarlo.
    return { error: 'sign_in_failed' };
  }

  // El perfil, ya bajo la sesión del invitado. El teléfono llega validado por el
  // schema (mismo criterio que el CHECK de la columna) y nunca como cadena vacía.
  const { error: profErr } = await userSupabase
    .from('profiles')
    .update({
      full_name: profile.full_name,
      phone: profile.phone,
      // Igual que arriba: solo si viene. Un `null` aquí pisaría con NULL la fecha que
      // el perfil ya tuviera, y la decisión es dejar las que hay como están.
      ...(profile.date_of_birth ? { date_of_birth: profile.date_of_birth } : {}),
      locale,
    })
    .eq('id', user.id);
  if (profErr) {
    logError(profErr, 'claim_profile_update', {
      target_uid: targetUid,
      pg_code: profErr.code,
      is_rls: profErr.code === '42501',
    });
    return { error: 'profile_update_failed' };
  }

  return { ok: { userId: user.id } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Aceptar el lote: la RPC y el mapeo de su error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traduce el error de `accept_pending_invitations` a un código con nombre.
 *
 * Vive aquí, y no en cada llamador, porque por esta RPC pasan LAS TRES acciones
 * del alta de la web (`acceptInvitation`, `acceptNewInvitee`, `acceptExistingUser`)
 * y ahora también la nativa: en cualquiera de ellas se quedaría a medias. El
 * orden de las comprobaciones se conserva tal cual estaba.
 */
export function mapAcceptRpcError(message: string | null | undefined): InviteAcceptError {
  const msg = message ?? '';
  if (msg.includes('account_deletion_in_progress')) return 'account_deletion_in_progress';
  if (msg.includes('consent_required')) return 'consent_required';
  if (msg.includes('wrong_email')) return 'wrong_email';
  if (msg.includes('not_found')) return 'not_found';
  if (msg.includes('no_session')) return 'no_session';
  if (msg.includes('image_decision_required')) return 'image_decision_required';
  if (msg.includes('image_required')) return 'image_required';
  if (msg.includes('reserved_for_tutor')) return 'reserved_for_tutor';
  if (msg.includes('tutor_menor_de_edad')) return 'tutor_menor_de_edad';
  return 'generic';
}

export type AcceptPendingOutcome =
  | { ok: { processed: number } }
  | { error: InviteAcceptError; raw?: unknown };

/**
 * La aceptación del lote: UNA llamada a la RPC = UNA transacción de Postgres.
 * Todo o nada.
 *
 * `children` y `medical` los pone el llamador. La web manda lo que el tutor
 * confirmó; la nativa manda `{}` y `{}` porque la cuenta propia del menor NO
 * trae datos reservados al tutor — y si los mandara, MN-3 respondería
 * `reserved_for_tutor`, que por eso tiene nombre propio en el mapeo.
 */
export async function acceptPendingInvitationsFromClient(
  userSupabase: Sb,
  args: {
    token: string;
    accepts: { terms: boolean; privacy: boolean };
    audit: { ip: string | null; userAgent: string | null };
    children?: Record<string, unknown>;
    medical?: Record<string, unknown>;
  },
): Promise<AcceptPendingOutcome> {
  const { data, error } = await userSupabase.rpc('accept_pending_invitations', {
    p_clicked_token: args.token,
    p_accept_terms: args.accepts.terms,
    p_accept_privacy: args.accepts.privacy,
    p_ip: args.audit.ip ?? undefined,
    p_user_agent: args.audit.userAgent ?? undefined,
    p_children: (args.children ?? {}) as never,
    p_medical: (args.medical ?? {}) as never,
  });
  if (error) return { error: mapAcceptRpcError(error.message), raw: error };
  return { ok: { processed: (data as number | null) ?? 0 } };
}
