/**
 * La IP del cliente, en UN solo sitio.
 *
 * Antes esto estaba copiado en cuatro ficheros como `fwd.split(',')[0]`. Se unifica
 * porque R-2 la usa para LIMITAR y no solo para auditar: si el límite y el registro de
 * auditoría leyeran la IP de formas distintas, un día dirían cosas distintas sobre el
 * mismo intento.
 *
 * LA TRAMPA, que conviene tener escrita: `x-forwarded-for` es una lista y el cliente
 * puede mandarla. En Vercel el edge la REESCRIBE con la IP real, así que coger el primer
 * elemento es correcto AQUÍ. Deja de serlo en cuanto haya otro proxy por delante: ahí el
 * primer elemento pasa a ser lo que el cliente quiera y el límite por IP se evapora sin
 * avisar a nadie. Si algún día se mete un proxy, este es el fichero que hay que mirar.
 *
 * Se devuelve `null` cuando no hay nada usable. Quien limita decide qué hacer con eso;
 * `register_invite_accept_attempt` lo trata como «las reglas de IP no aplican», que es
 * lo correcto: en Vercel una IP ausente es una anomalía de infraestructura, no un
 * cliente que se esconde (no puede).
 */

/**
 * Forma plausible de IPv4/IPv6. NO valida a rajatabla: solo descarta basura para que una
 * cabecera corrupta no acabe en un `inet` de Postgres provocando un error — y, con el
 * fail-closed del endpoint, una tanda de 503 por una cabecera mal formada.
 */
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

export function clientIpFrom(headers: Headers): string | null {
  const raw = headers.get('x-forwarded-for');
  if (!raw) return null;

  const first = raw.split(',')[0]?.trim();
  if (!first) return null;

  // IPv6 entre corchetes con puerto: [::1]:443
  const unbracketed = first.startsWith('[') ? (first.slice(1).split(']')[0] ?? '') : first;
  if (!unbracketed || !IP_RE.test(unbracketed)) return null;

  return unbracketed;
}
