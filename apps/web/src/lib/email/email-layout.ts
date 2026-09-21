import 'server-only';

/**
 * Correo-B · La maqueta común de los correos que manda la app.
 *
 * Sale de `invitation-email.ts`, donde vivía, al aparecer el segundo correo que la
 * necesita entera (el de restablecer contraseña). Es una extracción literal: mismo
 * HTML, mismos estilos, mismo texto plano. La alternativa —copiarla— es la que hace
 * que dentro de un año un correo tenga el botón de un color y el otro de otro, y que
 * un arreglo de compatibilidad se aplique solo a la mitad.
 *
 * Por qué es así de pobre —tabla no, marco no, imágenes no—: estilos en línea, un
 * botón y el enlace escrito debajo en texto. Los clientes de correo descuelgan el CSS
 * externo, bloquean las imágenes y no tienen dos clientes iguales; lo único que
 * SIEMPRE llega es el texto y un `<a>`. Y sin imágenes remotas, el correo no delata
 * cuándo se abrió ni desde dónde.
 *
 * Lo que NO se comparte es el contenido: cada correo trae sus siete piezas de su
 * propio espacio del catálogo. Esto solo las coloca.
 */

/** Las siete piezas de las que se hace un correo. */
export type PiezasCorreo = {
  heading: string;
  body: string;
  cta: string;
  url: string;
  fallback: string;
  ignore: string;
  signature: string;
};

/** Escapa lo que se mete en el HTML. El enlace lleva un token: nunca se interpola crudo. */
export function esc(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Envoltorio común: un párrafo de saludo, el botón, el enlace en claro y la despedida. */
export function maquetar(args: PiezasCorreo): string {
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
export function enTexto(args: PiezasCorreo): string {
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
