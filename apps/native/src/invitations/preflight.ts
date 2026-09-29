/**
 * R-5 · N-2 — el cliente de `/api/invitations/self-accept/preflight` y su MAPEO.
 *
 * POR QUÉ LA PANTALLA PREGUNTA ANTES. La ruta `/{locale}/invite/*` la reclaman las dos
 * tiendas, así que CUALQUIER invitación abierta desde el móvil aterriza en la pantalla
 * nativa — y esa pantalla atiende solo la cuenta propia del menor. Hasta N-1 el veredicto
 * solo llegaba al PULSAR: un padre rellenaba nombre, teléfono, contraseña y dos
 * consentimientos para que le dijeran que ahí no era.
 *
 * MISMO SITIO Y MISMA FORMA QUE `self-accept.ts`, y por la misma razón: lo que merece
 * prueba es el MAPEO, no la fontanería del fetch. El cliente HTTP se inyecta, así que
 * estas pruebas corren en Node sin arrastrar `expo-file-system` ni el cliente de
 * Supabase. Y los CÓDIGOS son los mismos que los del accept, así que el texto lo resuelve
 * `selfAcceptMessageKey` y no hay una segunda tabla de mensajes que mantener.
 */

import type { SelfAcceptCaller } from './self-accept';

/** Lo que la pantalla necesita saber ANTES de pintar nada. */
export type InvitePreflightOutcome =
  /** Es una invitación de cuenta propia del menor: el formulario de esta pantalla sirve. */
  | { ok: true }
  /**
   * No sirve. `error` es el código —el del servidor, o `no_web_url` / `network` cuando no
   * llegó a haber respuesta—, y `retryAfter` (segundos) solo viaja con `rate_limited`.
   */
  | { error: string; retryAfter?: number };

/**
 * Traduce la respuesta HTTP a veredicto. Puro.
 *
 * UN 200 QUE NO DICE `self` NO ES UN SÍ, y se trata como `not_self` a propósito. Es el
 * mismo criterio que `reads.ts` aplica al muro de pago —«un estado que no conocemos NO
 * puede abrir la puerta»— y el fallo seguro aquí es el mismo: si algún día el endpoint
 * aprende a contestar otro tipo, un build viejo dirá «esta invitación no es para la app,
 * ábrela en el navegador», que es verdad y es accionable. Lo contrario —enseñar el
 * formulario del menor por si acaso— es exactamente el fallo que N-2 viene a cerrar.
 *
 * El 429 va aparte porque es el único que trae CUÁNDO volver, y esa cifra la pone el
 * servidor (`Retry-After`): aquí no se inventa un minuto por defecto.
 */
export function mapPreflightResponse(
  status: number,
  payload: { error?: unknown; status?: unknown } | null,
  retryAfterHeader: string | null,
): InvitePreflightOutcome {
  if (status === 200) {
    return payload?.status === 'self' ? { ok: true } : { error: 'not_self' };
  }

  if (status === 429) {
    const parsed = Number(retryAfterHeader);
    const retry = Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : undefined;
    return retry === undefined
      ? { error: 'rate_limited' }
      : { error: 'rate_limited', retryAfter: retry };
  }

  const code = typeof payload?.error === 'string' ? payload.error : '';
  // Sin código reconocible no se inventa uno: `generic` ya tiene su texto.
  return { error: code || 'generic' };
}

/** Pregunta por el token y devuelve el veredicto ya mapeado. */
export async function fetchInvitePreflight(
  call: SelfAcceptCaller,
  token: string,
): Promise<InvitePreflightOutcome> {
  let res: Response;
  try {
    res = await call('/api/invitations/self-accept/preflight', { token });
  } catch (err) {
    // `no_web_url` es config ausente en el build y merece su propio texto: decirle
    // «sin conexión» a quien tiene cobertura manda a mirar donde no es.
    return { error: err instanceof Error && err.message === 'no_web_url' ? 'no_web_url' : 'network' };
  }

  let payload: { error?: unknown; status?: unknown } | null = null;
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = null;
  }

  return mapPreflightResponse(res.status, payload, res.headers.get('Retry-After'));
}

/**
 * ¿Este veredicto deja intentarlo otra vez?
 *
 * Se decide aquí y no en el componente por lo de siempre: un `if` dentro de React no lo
 * puede poner rojo nadie en este repo. `rate_limited` y `network` son los dos que se
 * arreglan solos con el tiempo o con cobertura; el resto son del TOKEN y reintentar solo
 * gastaría otro intento del contador.
 */
export function preflightSePuedeReintentar(code: string): boolean {
  return code === 'rate_limited' || code === 'network';
}

/**
 * ¿Hay que mandar al navegador?
 *
 * `not_self` es el caso del padre que abre su invitación desde el móvil: la web SÍ sabe
 * atenderla. Los demás veredictos son del token —caducado, ya aceptado, inexistente— y
 * en el navegador darían exactamente lo mismo, así que ofrecer el enlace ahí sería
 * mandar a alguien a un sitio donde tampoco puede hacer nada.
 */
export function preflightMandaAlNavegador(code: string): boolean {
  return code === 'not_self';
}
