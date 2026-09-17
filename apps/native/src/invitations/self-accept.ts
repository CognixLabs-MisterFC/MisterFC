/**
 * R-3 — el cliente de `/api/invitations/self-accept` y, sobre todo, su MAPEO.
 *
 * La pantalla no decide qué significa cada respuesta: lo decide este módulo, que es
 * lógica pura y tiene pruebas. Es el mismo criterio de R-2 con `decideSelfAccept`: un
 * `if` dentro de un componente de React no lo puede poner rojo nadie en este repo,
 * porque no hay pruebas de pantalla.
 *
 * LOS VEREDICTOS SON DE DOS ORÍGENES DISTINTOS y conviene no mezclarlos:
 *
 *   · Del GATE del endpoint (`decideSelfAccept`): not_found, already_accepted, expired,
 *     not_self, not_claimable. Son del TOKEN, y se ven ANTES de tocar nada.
 *   · De la RPC de aceptación: consent_required, wrong_email, reserved_for_tutor,
 *     account_deletion_in_progress… Son del ESTADO, y llegan después.
 *
 * NO IMPORTA EL CLIENTE HTTP, lo recibe. Importar `@/lib/server-api` metía
 * `expo-file-system` y el cliente de Supabase dentro de un test que corre en Node, y lo
 * que aquí merece prueba es el MAPEO, no la fontanería del fetch. Inyectarlo también
 * quita el baile de `vi.resetModules` que hacía falta para leer la variable de entorno.
 *
 * `wrong_email` está en el segundo grupo. En el caso self no debería aparecer —la sesión
 * se crea con la cuenta que la propia invitación designa, así que el correo cuadra por
 * construcción—, pero se mapea igual: el día que deje de ser cierto, prefiero un mensaje
 * que explique el problema a un «error genérico» que no dice nada.
 */

/** Lo que la pantalla necesita saber del intento. */
export type SelfAcceptOutcome =
  | { ok: { accessToken: string; refreshToken: string } }
  /**
   * No se pudo. `error` es el código: el que devolvió el servidor, o `no_web_url` /
   * `network` cuando no llegó a haber respuesta. `retryAfter` (segundos) solo viaja con
   * `rate_limited`, y solo si el servidor mandó la cabecera.
   *
   * UNA sola variante de error, no dos: separar "no hubo respuesta" en su propio miembro
   * de la unión parecía más preciso y lo único que conseguía era que `out.retryAfter` no
   * compilara sin estrechar antes, para distinguir dos casos que el llamante trata
   * exactamente igual — pintar un texto.
   */
  | { error: string; retryAfter?: number };

export type SelfAcceptBody = {
  token: string;
  full_name: string;
  phone: string;
  date_of_birth: string | null;
  password: string;
  confirm: string;
  accept_terms: boolean;
  accept_privacy: boolean;
  locale: string;
};

/**
 * Traduce una respuesta HTTP a veredicto. Puro: la pantalla y las pruebas lo llaman
 * igual.
 *
 * El 429 se trata aparte porque es el único que trae CUÁNDO volver, y esa cifra la pone
 * el servidor (`Retry-After`), no la app: aquí no se adivina un minuto por defecto que
 * luego no case con la ventana real del contador.
 */
export function mapSelfAcceptResponse(
  status: number,
  payload: { error?: unknown; access_token?: unknown; refresh_token?: unknown } | null,
  retryAfterHeader: string | null,
): SelfAcceptOutcome {
  if (status === 200) {
    const at = typeof payload?.access_token === 'string' ? payload.access_token : '';
    const rt = typeof payload?.refresh_token === 'string' ? payload.refresh_token : '';
    // Un 200 sin tokens no es un éxito: sin ellos no hay sesión que abrir.
    if (!at || !rt) return { error: 'no_session' };
    return { ok: { accessToken: at, refreshToken: rt } };
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

/**
 * Nombres que NO siguen el patrón `error_*` en el catálogo.
 *
 * El namespace `invite` lo escribió la web y no es homogéneo: la mayoría de los códigos
 * tienen su texto en `error_<codigo>`, pero unos pocos se llaman `missing_<algo>`. Sin
 * esta tabla, `phone_missing` buscaba `error_phone_missing`, que no existe, y la
 * pantalla habría pintado el NOMBRE DE LA CLAVE al usuario. No se renombran las claves
 * de la web para no tocar textos que ya están traducidos y en uso.
 */
const CLAVE_IRREGULAR: Record<string, string> = {
  phone_missing: 'missing_phone',
  password_missing: 'missing_password',
};

/** La clave de traducción del veredicto, dentro del namespace `invite`. */
export function selfAcceptMessageKey(code: string): string {
  return CLAVE_IRREGULAR[code] ?? `error_${code}`;
}

/** Quien sabe hablar con la web. En la app, `callPublicServerEndpoint`. */
export type SelfAcceptCaller = (path: string, body: unknown) => Promise<Response>;

/** Lanza el intento contra el endpoint y devuelve el veredicto ya mapeado. */
export async function submitSelfAccept(
  call: SelfAcceptCaller,
  body: SelfAcceptBody,
): Promise<SelfAcceptOutcome> {
  let res: Response;
  try {
    res = await call('/api/invitations/self-accept', body);
  } catch (err) {
    // `no_web_url` es config ausente en el build y merece su propio texto: decirle
    // «sin conexión» a quien tiene cobertura manda a mirar donde no es.
    return { error: err instanceof Error && err.message === 'no_web_url' ? 'no_web_url' : 'network' };
  }

  let payload: { error?: unknown; access_token?: unknown; refresh_token?: unknown } | null = null;
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = null;
  }

  return mapSelfAcceptResponse(res.status, payload, res.headers.get('Retry-After'));
}
