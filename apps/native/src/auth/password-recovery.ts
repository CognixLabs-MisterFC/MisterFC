/**
 * Correo-B · el cliente de `/api/auth/password-recovery` y, sobre todo, su MAPEO.
 *
 * Las dos puertas de la app —el modal del login y «cambiar contraseña» del perfil—
 * dejan de hablar con Supabase directamente. El motivo no es de estilo: el correo
 * ahora sale por Resend en el idioma del destinatario, y eso exige la service-role
 * key, que en un móvil no puede vivir. Lo manda la web y la app se lo pide.
 *
 * La pantalla no decide qué significa cada respuesta: lo decide este módulo, que es
 * lógica pura y tiene pruebas. Mismo criterio que `invitations/self-accept.ts`: un
 * `if` dentro de un componente de React no lo puede poner rojo nadie en este repo,
 * porque no hay pruebas de pantalla.
 *
 * NO IMPORTA EL CLIENTE HTTP, lo recibe. Importar `@/lib/server-api` metería
 * `expo-file-system` y el cliente de Supabase dentro de un test que corre en Node, y
 * lo que aquí merece prueba es el MAPEO, no la fontanería del fetch.
 *
 * LO QUE ESTE MÓDULO NO MANDA: el destino del enlace. Antes la app lo construía con
 * su `webBaseUrl()` y se lo pasaba a GoTrue; ahora lo decide el servidor con el host
 * de la propia petición. El `locale` sí viaja, pero solo como respaldo para cuando el
 * destinatario no tiene idioma en su perfil.
 */

/** Lo que la pantalla necesita saber del intento. */
export type RecoveryOutcome =
  /**
   * Se pidió correctamente. NO significa "existe esa cuenta": el servidor contesta
   * igual en los dos casos, a propósito, y la pantalla enseña el mismo texto de
   * siempre («si existe una cuenta asociada a…»).
   */
  | { ok: true }
  /**
   * `error` es el código: el del servidor, o `no_web_url` / `network` cuando no llegó
   * a haber respuesta. `retryAfter` (segundos) solo viaja con `rate_limited`, y solo
   * si el servidor mandó la cabecera.
   */
  | { error: string; retryAfter?: number };

/**
 * Traduce una respuesta HTTP a veredicto. Puro: la pantalla y las pruebas lo llaman
 * igual.
 *
 * El 429 se trata aparte porque es el único que trae CUÁNDO volver, y esa cifra la
 * pone el servidor (`Retry-After`), no la app: aquí no se adivina un minuto por
 * defecto que luego no case con la ventana real del contador.
 */
export function mapRecoveryResponse(
  status: number,
  payload: { ok?: unknown; error?: unknown } | null,
  retryAfterHeader: string | null,
): RecoveryOutcome {
  if (status === 200) return { ok: true };

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

/** Quien sabe hablar con la web. En la app, `callPublicServerEndpoint`. */
export type RecoveryCaller = (path: string, body: unknown) => Promise<Response>;

/** Pide el correo y devuelve el veredicto ya mapeado. */
export async function submitPasswordRecovery(
  call: RecoveryCaller,
  body: { email: string; locale: string },
): Promise<RecoveryOutcome> {
  let res: Response;
  try {
    res = await call('/api/auth/password-recovery', body);
  } catch (err) {
    // `no_web_url` es config ausente en el build y merece su propio texto: decirle
    // «sin conexión» a quien tiene cobertura manda a mirar donde no es.
    return {
      error: err instanceof Error && err.message === 'no_web_url' ? 'no_web_url' : 'network',
    };
  }

  let payload: { ok?: unknown; error?: unknown } | null = null;
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = null;
  }

  return mapRecoveryResponse(res.status, payload, res.headers.get('Retry-After'));
}

/**
 * Códigos que tienen texto propio en el catálogo. Todo lo demás cae en `generic`.
 *
 * Hace falta una lista EXPLÍCITA y no un `error_${code}` a pelo: el servidor puede
 * contestar códigos que la app no conoce —`unavailable` hoy, lo que se añada mañana—
 * y sin esto la pantalla pintaría el NOMBRE DE LA CLAVE al usuario. Es la misma
 * familia de tropiezo que `CLAVE_IRREGULAR` en `selfAcceptMessageKey`, pero cerrada
 * por el otro lado: allí se traducen los nombres raros que SÍ se conocen; aquí se
 * pone un suelo para los que no.
 */
const CON_TEXTO: ReadonlySet<string> = new Set([
  'invalid_email',
  'rate_limited',
  'network',
  'no_web_url',
]);

/** La clave de traducción del veredicto, dentro del namespace `auth.forgot_password`. */
export function recoveryMessageKey(code: string): string {
  return CON_TEXTO.has(code) ? `error_${code}` : 'error_generic';
}
