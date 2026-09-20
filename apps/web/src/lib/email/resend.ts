import 'server-only';

/**
 * Correo-B1 — Transporte de correo por la API de Resend.
 *
 * Hasta ahora los correos de invitación los mandaba GoTrue como efecto secundario de
 * `inviteUserByEmail`, con una plantilla única guardada en el dashboard de Supabase.
 * Esa plantilla no puede leer `profiles.locale`: salía siempre en castellano, también
 * para quien tiene la app en valenciano o en inglés.
 *
 * El relay ya era Resend (la config de Auth manda por `smtp.resend.com` con el
 * remitente `no-reply@misterfc.es`), así que esto no estrena proveedor ni dominio: le
 * habla directamente en vez de a través de GoTrue, que es lo que permite decidir el
 * idioma, el asunto y el cuerpo desde el código.
 *
 * Qué cambia de límites: el tope de 30 correos/hora que impone Supabase
 * (`rate_limit_email_sent`) deja de aplicar a estos envíos; rige el de la cuenta de
 * Resend.
 *
 * No lanza NUNCA: devuelve `{ error }`. Quien invita no debe ver una excepción porque
 * un proveedor de correo tarde en responder, y el caller ya decide qué hacer.
 */

/** Remitente. El mismo que ya usaba el relay SMTP: dominio verificado y en uso. */
export const EMAIL_FROM = 'MisterFC <no-reply@misterfc.es>';

/** Un correo ya compuesto, listo para enviar. */
export type EmailMessage = {
  subject: string;
  html: string;
  /** Alternativa en texto plano. No es opcional: sin ella el correo puntúa peor en los filtros de spam y hay clientes que solo muestran esto. */
  text: string;
};

export type SendEmailResult = { error: unknown | null; id?: string };

/**
 * Tiempo máximo esperando a Resend. Va dentro de una Server Action: sin tope, un
 * proveedor lento deja al que invita mirando un botón que no vuelve.
 */
const TIMEOUT_MS = 10_000;

/** Error con forma legible en Sentry (el caller lo registra tal cual). */
function emailError(message: string, extra?: Record<string, unknown>): Error {
  const err = new Error(message);
  if (extra) Object.assign(err, extra);
  return err;
}

/**
 * Manda un correo por Resend. `RESEND_API_KEY` es secreto de servidor: sin él no se
 * manda nada y se devuelve error —nunca un "éxito" silencioso, que dejaría una
 * invitación creada y a nadie avisado—.
 */
export async function sendEmail(args: {
  to: string;
  message: EmailMessage;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { error: emailError('RESEND_API_KEY no configurada') };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [args.to],
        subject: args.message.subject,
        html: args.message.html,
        text: args.message.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // El cuerpo de Resend trae el motivo (dominio sin verificar, clave revocada,
      // rate limit). Va al log: sin él, todo fallo de correo se parece.
      const detalle = await res.text().catch(() => '');
      return {
        error: emailError(`Resend respondió ${res.status}`, {
          status: res.status,
          detalle: detalle.slice(0, 500),
        }),
      };
    }

    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { error: null, id: body?.id };
  } catch (thrown) {
    return { error: thrown };
  }
}
