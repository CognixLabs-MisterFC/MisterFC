'use server';

import * as Sentry from '@sentry/nextjs';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import {
  crearLimitePorVentana,
  DEMO_CAMPOS,
  isMarketingSiteOn,
  leerSolicitudDemo,
  type DemoCampo,
} from '@misterfc/core';
import { routing } from '@/i18n/routing';
import { clientIpFrom } from '@/lib/client-ip';
import { sendEmail } from '@/lib/email/resend';
import { demoAcuse, demoAvisoEquipo, demoFrom, demoTo } from '@/lib/email/demo-email';

export type DemoFormState = {
  error?: 'campos' | 'limite' | 'envio';
  campos?: DemoCampo[];
  /** Lo que se había escrito, para no perderlo al volver con un error. */
  valores?: Partial<Record<DemoCampo, string>>;
};

/** 5 envíos por IP y hora, en memoria (spec §8.3). Uno por instancia de la función. */
const limite = crearLimitePorVentana({ max: 5, ventanaMs: 60 * 60 * 1000 });

/**
 * Server Action del formulario de demo (spec §8).
 *
 * Orden: campo trampa, campos, límite, aviso al equipo y acuse. El límite va después de
 * validar para que un error de escritura no gaste envíos, y antes de mandar nada, que
 * es lo que cuesta.
 *
 * Lo que tiene que llegar es el AVISO: si falla, se dice y se ofrece el correo de
 * contacto. Si falla solo el acuse, la solicitud ya está en manos del equipo y se va a
 * la página de gracias igual; el fallo va a Sentry.
 */
export async function solicitarDemo(
  locale: string,
  _prev: DemoFormState,
  formData: FormData,
): Promise<DemoFormState> {
  // Con la web apagada la página no pinta el formulario; esto cierra la llamada directa.
  if (!isMarketingSiteOn(process.env) || !hasLocale(routing.locales, locale)) {
    return { error: 'envio' };
  }

  const leer = (campo: string) => {
    const v = formData.get(campo);
    return typeof v === 'string' ? v : null;
  };
  const valores: Partial<Record<DemoCampo, string>> = {};
  for (const c of DEMO_CAMPOS) {
    const v = leer(c);
    if (v !== null) valores[c] = v;
  }

  const lectura = leerSolicitudDemo(leer);
  if (lectura.estado === 'trampa') redirect(`/${locale}/demo/gracias`);
  if (lectura.estado === 'invalida') return { error: 'campos', campos: lectura.campos, valores };

  const ip = clientIpFrom(await headers()) ?? 'sin-ip';
  if (!limite.intentar(ip).ok) return { error: 'limite', valores };

  const datos = lectura.datos;
  const aviso = await sendEmail({
    to: demoTo(),
    from: demoFrom(),
    replyTo: datos.email,
    message: await demoAvisoEquipo(datos, locale),
  });
  if (aviso.error) {
    Sentry.captureException(aviso.error, { tags: { feature: 'web_demo', step: 'aviso' } });
    return { error: 'envio', valores };
  }

  const acuse = await sendEmail({
    to: datos.email,
    from: demoFrom(),
    replyTo: demoTo(),
    message: await demoAcuse(locale),
  });
  if (acuse.error) {
    Sentry.captureException(acuse.error, { tags: { feature: 'web_demo', step: 'acuse' } });
  }

  redirect(`/${locale}/demo/gracias`);
}
