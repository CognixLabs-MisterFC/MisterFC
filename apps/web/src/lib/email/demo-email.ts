import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { DemoSolicitud } from '@misterfc/core';
import type { EmailMessage } from './resend';
import { esc } from './email-layout';

/**
 * Web comercial · los dos correos del formulario de demo (spec §8.3).
 *
 * No usan `maquetar` porque no llevan botón ni enlace: el acuse solo confirma y el
 * aviso solo lista campos. Sí copian sus estilos, para que se parezcan a los demás
 * correos de MisterFC.
 */

/** Destino del aviso, y `Reply-To` del acuse. `DEMO_TO` lo cambia sin tocar código. */
export function demoTo(): string {
  return process.env.DEMO_TO || 'info.cognixlabs@gmail.com';
}

/** Remitente de los dos. `misterfc.es` está verificado en Resend. */
export function demoFrom(): string {
  return process.env.DEMO_FROM || 'MisterFC <demo@misterfc.es>';
}

function caja(interior: string): string {
  return `<div style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1b2e;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
${interior}
  </div>
</div>`;
}

/**
 * Acuse al solicitante, en su idioma y sin publicidad.
 *
 * NO LLEVA NADA DE LO QUE ESCRIBIÓ: ni su nombre ni el del club ni el comentario. El
 * formulario está abierto y cualquiera puede poner un correo ajeno; si el acuse
 * repitiera lo escrito, el formulario serviría para mandar un texto cualquiera desde
 * `misterfc.es` a quien se quiera. Por eso es fijo, y por eso dice qué hacer si no lo
 * pediste.
 */
export async function demoAcuse(locale: string): Promise<EmailMessage> {
  const t = await getTranslations({ locale, namespace: 'webComercial.demo.acuse' });
  const p = 'margin:0 0 16px;font-size:15px;line-height:1.6;color:#33415c;';
  const pie = 'margin:0 0 4px;font-size:13px;line-height:1.6;color:#6b7280;';

  return {
    subject: t('asunto'),
    html: caja(`    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f1b2e;">${esc(t('titulo'))}</h1>
    <p style="${p}">${esc(t('texto'))}</p>
    <p style="${pie}">${esc(t('ignorar'))}</p>
    <p style="${pie}">${esc(t('firma'))}</p>`),
    text: [t('titulo'), '', t('texto'), '', t('ignorar'), t('firma'), ''].join('\n'),
  };
}

/**
 * Aviso al equipo, con todos los campos. Siempre en castellano —es para Cognix—, con
 * las etiquetas del catálogo `es` para que digan lo mismo que el formulario. El idioma
 * del solicitante va en el aviso: es el idioma en que conviene contestarle.
 */
export async function demoAvisoEquipo(datos: DemoSolicitud, locale: string): Promise<EmailMessage> {
  const t = await getTranslations({ locale: 'es', namespace: 'webComercial.demo' });
  const filas: [string, string][] = [
    [t('campos.nombre'), datos.nombre],
    [t('campos.papel'), t(`papeles.${datos.papel}`)],
    [t('campos.club'), datos.club],
    [t('campos.municipio'), datos.municipio],
    [t('campos.equipos'), t(`equiposOpciones.${datos.equipos}`)],
    [t('campos.email'), datos.email],
    [t('campos.telefono'), datos.telefono || '—'],
    [t('campos.comentario'), datos.comentario || '—'],
    ['Idioma de la web', locale],
  ];

  const celda = 'padding:6px 12px 6px 0;font-size:14px;line-height:1.5;vertical-align:top;';
  const tabla = filas
    .map(
      ([k, v]) =>
        `      <tr><td style="${celda}color:#6b7280;white-space:nowrap;">${esc(k)}</td><td style="${celda}color:#0f1b2e;white-space:pre-wrap;">${esc(v)}</td></tr>`,
    )
    .join('\n');

  return {
    subject: `Solicitud de demo: ${datos.club}`,
    html: caja(`    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f1b2e;">Nueva solicitud de demo</h1>
    <table style="border-collapse:collapse;">
${tabla}
    </table>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">Responder a este correo le escribe al solicitante.</p>`),
    text: [
      'Nueva solicitud de demo',
      '',
      ...filas.map(([k, v]) => `${k}: ${v}`),
      '',
      'Responder a este correo le escribe al solicitante.',
      '',
    ].join('\n'),
  };
}
