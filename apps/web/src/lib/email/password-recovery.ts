import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { createSupabaseAdminClient, recoveryRedirectTo } from '@misterfc/core';
import { sendEmail } from './resend';
import { passwordRecoveryEmail } from './password-recovery-email';
import { lookupInviteRecipient, normalizeLocale } from './invite-recipient';

/**
 * Correo-B · El envío del correo de restablecer contraseña, en un solo sitio.
 *
 * Las tres puertas que lo piden —el formulario de la web, el modal de la app y
 * «cambiar contraseña» del perfil— llaman aquí. El motivo de que sea UNA función y no
 * el patrón de puertos de las invitaciones es el contrario del de allí: en las
 * invitaciones cada sender hace cosas distintas antes de mandar (crea, enlaza,
 * renueva) y por eso el censo los cuenta uno a uno; aquí las tres puertas hacen
 * EXACTAMENTE lo mismo y lo único que cambia es quién pregunta. Tres copias serían
 * tres sitios donde olvidarse del límite.
 *
 * ── POR QUÉ `generateLink` Y NO `resetPasswordForEmail` ────────────────────
 *
 * `resetPasswordForEmail` hace las dos cosas a la vez: fabrica el enlace y manda el
 * correo, por Supabase y con la plantilla del dashboard. Para escribir nosotros el
 * correo hace falta separarlas, y la mitad que fabrica el enlace sin mandar nada es
 * `admin.generateLink`. Es el primer uso de esa forma en el repo.
 *
 * ── Y POR QUÉ ESO NO REABRE EL BUG 4 ───────────────────────────────────────
 *
 * Porque el `action_link` que devuelve es el MISMO artefacto que ya recibe la app
 * hoy: un `/auth/v1/verify` que, tras verificar, redirige a `redirect_to` con la
 * sesión en el FRAGMENTO (flujo implícito). Ese camino no es nuevo ni está sin
 * probar — es justo el que arregló el BUG 4 y el que usa la app desde entonces:
 * `AuthHashHandler` canjea el fragmento en el layout y `ResetPasswordGate` espera a
 * que aparezca la sesión antes de decidir si el enlace ha caducado.
 *
 * Lo que SÍ cambia, y conviene tenerlo escrito: la web deja de ir por PKCE. Hasta
 * ahora su Server Action usaba `@supabase/ssr` y el correo traía `?code=`, que el
 * middleware reencaminaba al callback. Desde aquí las tres puertas van por el mismo
 * camino, el implícito. `recoveryRedirectTo` sigue mandando DIRECTO a
 * `/{locale}/reset-password`, que es la parte que no se puede tocar.
 *
 * ── EL LÍMITE VA PRIMERO ───────────────────────────────────────────────────
 *
 * Antes de buscar la cuenta y antes de hablar con GoTrue, porque lo que protege es
 * el coste: una invocación de función, una llamada admin y un correo que se paga. Y
 * FALLA CERRADO —si el contador no responde, no se manda nada—: no añade fragilidad,
 * porque sin base de datos tampoco habría a quién mandárselo.
 */

/** Qué pasó. La puerta decide qué enseñar; aquí no se decide nada de interfaz. */
export type ResultadoRecuperacion =
  | { estado: 'enviado' }
  /** No hay cuenta con ese correo. NO es un error: no se manda nada y no se dice. */
  | { estado: 'sin_cuenta' }
  | { estado: 'limitado'; esperaSegundos: number }
  /** El contador no contestó. Falla cerrado. */
  | { estado: 'no_disponible' }
  | { estado: 'fallo' };

export async function enviarCorreoRecuperacion(args: {
  email: string;
  /** Idioma de quien lo pide, por si el destinatario no tiene perfil o no tiene idioma. */
  locale: string;
  /** IP del cliente, o null si no se pudo derivar (entonces solo corre la regla del correo). */
  ip: string | null;
  /** Origen para construir el destino: `https://misterfc.es`, el preview de Vercel… */
  baseUrl: string;
}): Promise<ResultadoRecuperacion> {
  const email = args.email.trim().toLowerCase();
  const admin = createSupabaseAdminClient();

  // ── 1 · El límite, antes que nada caro ────────────────────────────────────
  const { data: filas, error: errLimite } = await admin.rpc(
    'register_password_recovery_attempt',
    { p_email: email, p_ip: args.ip ?? undefined },
  );
  if (errLimite) {
    Sentry.captureException(errLimite, {
      tags: { feature: 'password_recovery', step: 'rate_limit' },
    });
    return { estado: 'no_disponible' };
  }
  const limite = Array.isArray(filas) ? filas[0] : filas;
  if (!limite) return { estado: 'no_disponible' };
  if (limite.decision !== 'ok') {
    return { estado: 'limitado', esperaSegundos: limite.retry_after_seconds ?? 60 };
  }

  // ── 2 · ¿Quién hay detrás, y en qué idioma se le escribe? ─────────────────
  // El mismo buscador que usan las invitaciones. Devuelve null también cuando GoTrue
  // tropieza, y eso aquí es correcto: se trata igual que "no hay cuenta" —no se manda
  // nada y no se dice nada—, que es lo que ya hacía Supabase.
  const destinatario = await lookupInviteRecipient(admin, email);
  if (!destinatario) return { estado: 'sin_cuenta' };

  const locale = normalizeLocale(destinatario.locale, normalizeLocale(args.locale, 'es'));

  // ── 3 · El enlace ─────────────────────────────────────────────────────────
  const redirectTo = recoveryRedirectTo(args.baseUrl, locale);
  const { data: enlace, error: errEnlace } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  const url = enlace?.properties?.action_link;
  if (errEnlace || !url) {
    Sentry.captureException(errEnlace ?? new Error('generateLink sin action_link'), {
      tags: { feature: 'password_recovery', step: 'generate_link' },
    });
    return { estado: 'fallo' };
  }

  // ── 4 · El correo ─────────────────────────────────────────────────────────
  try {
    const message = await passwordRecoveryEmail({ locale, url });
    const { error: errCorreo } = await sendEmail({ to: email, message });
    if (errCorreo) {
      Sentry.captureException(errCorreo, {
        tags: { feature: 'password_recovery', step: 'send' },
        extra: { locale },
      });
      return { estado: 'fallo' };
    }
  } catch (thrown) {
    // Componer también puede fallar (una clave que falte en un idioma). Es un fallo
    // de correo como cualquier otro, pero se registra aparte porque se arregla en
    // otro sitio: el catálogo.
    Sentry.captureException(thrown, {
      tags: { feature: 'password_recovery', step: 'compose' },
      extra: { locale },
    });
    return { estado: 'fallo' };
  }

  return { estado: 'enviado' };
}
