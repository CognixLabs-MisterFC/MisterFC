import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { InviteKind } from '@misterfc/core';
import type { EmailMessage } from './resend';

/**
 * Correo-B1 — La plantilla del correo de invitación.
 *
 * Vive aquí y no en el dashboard de Supabase (que es donde vivía) por tres razones,
 * y la tercera es la que motivó la serie:
 *   · se revisa en un PR como cualquier otro código;
 *   · el asunto no está limitado a 255 caracteres ni escrito en plantillas Go;
 *   · y puede componerse en el idioma del DESTINATARIO, porque aquí sí se sabe cuál
 *     es. La plantilla de GoTrue no puede leer `profiles.locale`.
 *
 * Los textos viven en `messages/{es,en,va}.json` bajo `emails.spectator_invite`, con
 * el resto del producto: un correo es interfaz, y no tiene por qué traducirse en otro
 * sitio ni con otras herramientas.
 *
 * El HTML es deliberadamente pobre —tabla no, marco no, imágenes no—: estilos en
 * línea, un botón y el enlace escrito debajo en texto. Los clientes de correo
 * descuelgan el CSS externo, bloquean las imágenes y no tienen dos clientes iguales;
 * lo único que SIEMPRE llega es el texto y un `<a>`. Y sin imágenes remotas, el
 * correo no delata cuándo se abrió ni desde dónde.
 */

/** Escapa lo que se mete en el HTML. El enlace lleva un token: nunca se interpola crudo. */
function esc(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Envoltorio común: un párrafo de saludo, el botón, el enlace en claro y la despedida. */
function maquetar(args: {
  heading: string;
  body: string;
  cta: string;
  url: string;
  fallback: string;
  ignore: string;
  signature: string;
}): string {
  const url = esc(args.url);
  return `<div style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1b2e;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f1b2e;">${esc(args.heading)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#33415c;">${esc(args.body)}</p>
    <p style="margin:0 0 24px;">
      <a href="${url}" style="display:inline-block;background:#0f1b2e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;">${esc(args.cta)}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">${esc(args.fallback)}</p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${url}" style="color:#0f1b2e;">${url}</a></p>
    <p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#6b7280;">${esc(args.ignore)}</p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">${esc(args.signature)}</p>
  </div>
</div>`;
}

/** La misma pieza en texto plano, con el enlace entero: es lo único que llega seguro. */
function enTexto(args: {
  heading: string;
  body: string;
  url: string;
  fallback: string;
  ignore: string;
  signature: string;
}): string {
  return [
    args.heading,
    '',
    args.body,
    '',
    args.fallback,
    args.url,
    '',
    args.ignore,
    args.signature,
    '',
  ].join('\n');
}

/**
 * Qué textos usa cada tipo de invitación. La serie Correo-B va añadiendo entradas
 * según migra senders; los que faltan siguen saliendo por la plantilla de Supabase.
 *
 * `InviteKind` viene de core y es el MISMO valor que el sender mete en el
 * `user_metadata` de la cuenta, así que no hay dos listas que mantener a la vez.
 */
const NAMESPACE_BY_KIND: Partial<Record<InviteKind, string>> = {
  seguidor: 'emails.spectator_invite',
  menor: 'emails.self_invite',
  admin: 'emails.admin_invite',
};

/**
 * Correo de invitación del tipo que sea, en el idioma que se le pase.
 *
 * NO dice el nombre del jugador, y es deliberado: a esa dirección todavía no hay
 * nadie identificado —puede estar mal escrita— y el nombre de un menor no se manda a
 * una dirección sin comprobar. Quién es se ve al entrar, después del enlace, que
 * exige el token.
 *
 * Un `kind` sin textos LANZA en vez de mandar algo genérico: el sender lo trata como
 * cualquier fallo de correo y queda el rastro. Un correo mudo no se nota.
 */
export async function invitationEmail(args: {
  kind: InviteKind;
  locale: string;
  url: string;
}): Promise<EmailMessage> {
  const namespace = NAMESPACE_BY_KIND[args.kind];
  if (!namespace) {
    throw new Error(`invitationEmail: no hay textos para el tipo '${args.kind}'`);
  }
  const t = await getTranslations({ locale: args.locale, namespace });

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
