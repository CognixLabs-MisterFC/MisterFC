'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { forgotPasswordSchema } from '@misterfc/core';
import { clientIpFrom } from '@/lib/client-ip';
import { enviarCorreoRecuperacion } from '@/lib/email/password-recovery';

export type ForgotPasswordFormState = {
  error?: 'invalid_email' | 'generic' | 'rate_limited';
  /** Minutos que faltan, solo con `rate_limited`. */
  retryMinutes?: number;
};

/**
 * Server Action: pide el correo para restablecer la contraseña.
 *
 * Desde Correo-B el correo lo manda la app por Resend, en el idioma del destinatario
 * (`profiles.locale`), y no Supabase con su plantilla única en castellano. Todo eso
 * vive en `lib/email/password-recovery.ts`, que es el mismo sitio al que llamarán las
 * dos puertas de la app; aquí solo queda traducir el resultado a lo que ve la
 * pantalla.
 *
 * LO QUE NO CAMBIA, Y ES LO IMPORTANTE: no se revela si el correo existe. Una cuenta
 * que no está y una a la que se le acaba de mandar el enlace terminan las dos en
 * `/check-email`, que es lo que ya hacía Supabase por diseño.
 *
 * El límite SÍ se cuenta —`rate_limited` se ve—, y eso no es una fuga: el contador se
 * indexa por correo exista o no la cuenta, así que verlo no dice nada sobre si hay
 * alguien detrás. Callárselo sería peor: quien ha pedido el enlace cinco veces se
 * quedaría mirando una pantalla que dice «revisa tu correo» sin que llegue nada.
 */
export async function requestPasswordReset(
  locale: string,
  _prev: ForgotPasswordFormState,
  formData: FormData,
): Promise<ForgotPasswordFormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return { error: 'invalid_email' };
  }

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';

  const resultado = await enviarCorreoRecuperacion({
    email: parsed.data.email,
    locale,
    ip: clientIpFrom(hdrs),
    baseUrl: `${proto}://${host}`,
  });

  if (resultado.estado === 'limitado') {
    return {
      error: 'rate_limited',
      retryMinutes: Math.max(1, Math.ceil(resultado.esperaSegundos / 60)),
    };
  }
  if (resultado.estado === 'fallo' || resultado.estado === 'no_disponible') {
    return { error: 'generic' };
  }

  // `enviado` y `sin_cuenta` acaban igual, a propósito.
  redirect(`/${locale}/check-email?context=reset&email=${encodeURIComponent(parsed.data.email)}`);
}
