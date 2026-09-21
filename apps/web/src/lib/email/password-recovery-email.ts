import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { EmailMessage } from './resend';
import { maquetar, enTexto } from './email-layout';

/**
 * Correo-B · El correo de restablecer contraseña.
 *
 * Era el octavo y último que seguía saliendo por Supabase, con la plantilla
 * `recovery` del dashboard: una sola, en castellano, para todo el mundo. Aquí se
 * compone en el idioma del destinatario como los siete de invitación.
 *
 * NO LLEVA UN SOLO DATO DE LA CUENTA — ni el nombre, ni el club, ni el correo al que
 * va. Es el único de la familia que se pide sin sesión y desde un formulario abierto:
 * lo único que sabemos es que alguien ha escrito esa dirección, no que sea suya. Un
 * correo que dijera «hola, Ana» confirmaría a quien lo provoque que esa dirección
 * tiene cuenta, y ese es justo el dato que la pantalla se cuida de no dar.
 *
 * El texto vive en `messages/{es,en,va}.json` bajo `emails.password_recovery`, con el
 * resto del producto. Una clave que falte en un idioma NO es un error de compilación:
 * es una excepción en el envío, en producción, y solo para quien tenga ese idioma.
 * Por eso lo vigila `scripts/check-correo-recuperacion.mjs`.
 */
export async function passwordRecoveryEmail(args: {
  locale: string;
  url: string;
}): Promise<EmailMessage> {
  const t = await getTranslations({ locale: args.locale, namespace: 'emails.password_recovery' });

  const piezas = {
    heading: t('heading'),
    body: t('body'),
    cta: t('cta'),
    url: args.url,
    fallback: t('fallback'),
    ignore: t('ignore'),
    signature: t('signature'),
  };

  return {
    subject: t('subject'),
    html: maquetar(piezas),
    text: enTexto(piezas),
  };
}
