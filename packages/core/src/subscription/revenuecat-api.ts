/**
 * SU-3 — cliente REST de RevenueCat. Solo SERVIDOR: exige la *secret key*.
 *
 * Solo lo que necesita el antídoto de ADR-0022 §4c. Todo lo demás (precios, ofertas,
 * métricas) lo lleva su panel; no queremos más superficie de la imprescindible.
 *
 * ⚠️ AVISO QUE CAMBIA UNA DECISIÓN, comprobado en su API v1 al escribir SU-3:
 * `GET /subscribers/{app_user_id}` devuelve **201 y CREA el cliente** si no existe. O
 * sea que consultar por una cuenta que acabamos de borrar la RESUCITA en su lado — el
 * espejo exacto de lo que este módulo existe para impedir. Por eso `getCustomer` exige
 * que el llamante afirme que la cuenta sigue viva, y la reconciliación de SU-6 NO puede
 * preguntar por cuentas desenganchadas.
 */

const API_BASE = 'https://api.revenuecat.com/v1';

/** `fetch` inyectable: los tests no tocan la red y el servidor usa el global. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RevenueCatConfig = {
  /** Secret key del proyecto. NUNCA la pública, y nunca en el cliente. */
  secretKey: string;
  fetchImpl?: FetchLike;
};

export type DeleteCustomerResult =
  | { ok: true; alreadyGone: boolean }
  | { ok: false; status: number | null; raw: unknown };

/**
 * `DELETE /subscribers/{app_user_id}` — la supresión en el encargado de tratamiento.
 *
 * RevenueCat declara que borrar un cliente elimina todos sus datos y es suficiente para
 * una solicitud de supresión del RGPD. **No cancela la suscripción en la tienda**: eso
 * lo hace la persona desde Ajustes, y el flujo de borrado ya se lo dice (BC.0 §8.1).
 *
 * 200 y 404 son AMBOS éxito: 404 significa que ya no está, que es justo lo que
 * queríamos. Tratarlo como fallo haría que la cola reintentara para siempre.
 *
 * El borrado es asíncrono en su lado: un 200 es "encolado", no "ya está".
 */
export async function deleteRevenueCatCustomer(
  appUserId: string,
  config: RevenueCatConfig,
): Promise<DeleteCustomerResult> {
  const doFetch = config.fetchImpl ?? (globalThis.fetch as FetchLike);
  let res: Response;
  try {
    res = await doFetch(`${API_BASE}/subscribers/${encodeURIComponent(appUserId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    // Red caída: la cola lo reintenta. No es un estado final.
    return { ok: false, status: null, raw: e };
  }

  if (res.status === 200) return { ok: true, alreadyGone: false };
  if (res.status === 404) return { ok: true, alreadyGone: true };

  let body: unknown = null;
  try {
    body = await res.text();
  } catch {
    body = null;
  }
  return { ok: false, status: res.status, raw: body };
}

export type GetCustomerResult =
  | { ok: true; subscriber: unknown; created: boolean }
  | { ok: false; status: number | null; raw: unknown };

export type GetCustomerOptions = {
  /**
   * Qué hacer con un 201 (= el GET acaba de CREAR el cliente).
   *
   *  · `'error'` (por defecto) — lo que necesita la reconciliación nocturna: un 201 ahí
   *    significa que hemos preguntado por alguien que no existía y ya hemos hecho el
   *    daño, así que tiene que verse en Sentry.
   *  · `'accept'` — lo que necesita la RECLAMACIÓN de SU-6b: ahí pregunta la propia
   *    persona por su propia cuenta con una sesión viva, y un 201 solo quiere decir
   *    "esta cuenta nunca compró nada". El cliente creado es el mismo registro vacío que
   *    el SDK crea en el `configure()` del primer arranque; no resucita nada porque la
   *    cuenta está viva, y eso lo comprueba el llamante ANTES de llamar.
   */
  on201?: 'error' | 'accept';
};

/**
 * `GET /subscribers/{app_user_id}` — la lectura de reconciliación de SU-6.
 *
 * `assertNotDeleted` NO es ceremonia: este endpoint CREA el cliente si no existe (201),
 * así que preguntar por una cuenta anonimizada la volvería a crear en RevenueCat y
 * reabriría el agujero que ADR-0022 cierra. El llamante tiene que haber comprobado que
 * la cuenta sigue viva ANTES de llamar, y decirlo aquí.
 */
export async function getRevenueCatCustomer(
  appUserId: string,
  config: RevenueCatConfig,
  assertNotDeleted: true,
  options: GetCustomerOptions = {},
): Promise<GetCustomerResult> {
  void assertNotDeleted;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as FetchLike);
  let res: Response;
  try {
    res = await doFetch(`${API_BASE}/subscribers/${encodeURIComponent(appUserId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.secretKey}` },
    });
  } catch (e) {
    return { ok: false, status: null, raw: e };
  }

  // 201 = lo acaba de CREAR. Para la reconciliación eso no es un éxito: significa que
  // hemos preguntado por alguien que no existía, y ya hemos hecho el daño. Se devuelve
  // como error para que quede en Sentry y se vea de dónde salió la llamada. La
  // reclamación de SU-6b es el único sitio que lo acepta, y con motivo (ver
  // `GetCustomerOptions`).
  if (res.status === 201) {
    if ((options.on201 ?? 'error') === 'error') {
      return { ok: false, status: 201, raw: 'el GET ha CREADO el cliente: no se debía preguntar' };
    }
    try {
      return { ok: true, subscriber: await res.json(), created: true };
    } catch (e) {
      return { ok: false, status: res.status, raw: e };
    }
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.text();
    } catch {
      body = null;
    }
    return { ok: false, status: res.status, raw: body };
  }

  try {
    return { ok: true, subscriber: await res.json(), created: false };
  } catch (e) {
    return { ok: false, status: res.status, raw: e };
  }
}
