/**
 * SU-6b — PROYECCIÓN del objeto `subscriber` de la API REST v1 de RevenueCat.
 *
 * Es la pieza que traduce lo que responde `GET /subscribers/{id}` a las tres fechas que
 * guarda `subscription_entitlements`. Pura y sin red: es lo único de la reconciliación
 * que se puede probar entero sin inventar un servidor.
 *
 * TRES COSAS CONTRASTADAS CONTRA SU DOCUMENTACIÓN VIVA al escribir SU-6b, porque las
 * tres cambian el código y ninguna se adivina:
 *
 *  1. `billing_issues_detected_at` **vuelve null aunque el cliente tenga un impago**.
 *     No es una suposición: está reconocido por RevenueCat en su propio foro
 *     (Haley Pace, 15-11-2024: «I was able to find this on my end and can see that
 *     billing_issues_detected_at is indeed null despite this user having one»), sin
 *     resolver. Consecuencia directa: una reconciliación que copiara ese campo tal cual
 *     BORRARÍA el impago de todas las cuentas en la primera pasada nocturna — justo la
 *     señal que ordena la lista de candidatos. Ver `billingIssueAfterReconcile`.
 *
 *  2. La gracia sí se puede leer, y es la vía recomendada: `grace_period_expires_date`
 *     es null cuando no hay gracia, y vuelve a null en cuanto renuevan. (Con Stripe es
 *     siempre null, pero nosotros no cobramos por Stripe: App Store y Play.)
 *
 *  3. Cada suscripción trae `is_sandbox`. Sin mirarlo, una compra de TestFlight abriría
 *     la puerta de producción por esta vía, que es exactamente lo que
 *     `apply_subscription_event` rechaza en el camino del webhook. Aquí NO se revoca ni
 *     se concede nada con datos de sandbox: se deja la fila como está.
 *
 * Campos del objeto, tal y como los documenta la v1:
 *   · `entitlements[id]`        → expires_date, grace_period_expires_date,
 *                                 product_identifier, purchase_date
 *   · `subscriptions[product]`  → expires_date, grace_period_expires_date,
 *                                 billing_issues_detected_at, is_sandbox, store,
 *                                 store_transaction_id, unsubscribe_detected_at,
 *                                 period_type, auto_resume_date, refunded_at,
 *                                 ownership_type, purchase_date, original_purchase_date
 */

/**
 * El entitlement que da acceso. Tiene que ser EXACTAMENTE el mismo literal que usa la
 * nativa (`apps/native/src/subscription/purchases.ts`), y no se importa de allí porque
 * ese módulo no puede depender de core. Lo que ata los dos sitios es un test de
 * contrato que lee el fichero de la nativa: si alguien cambia uno, salta.
 */
export const PREMIUM_ENTITLEMENT_ID = 'PREMIUM';

/** Lo que la reconciliación necesita saber de un cliente de RevenueCat. */
export type SubscriberProjection = {
  /** ¿Existe el entitlement PREMIUM? Puede existir y estar VENCIDO: eso no es lo mismo
   *  que no existir, y el barrido los trata distinto (uno se corrige, el otro se avisa). */
  entitled: boolean;
  /** La suscripción que sostiene el entitlement es de sandbox. No se escribe nada. */
  sandbox: boolean;
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  /** Lo que dice la API. Hoy es null casi siempre (aviso 1 de la cabecera). */
  billingIssueAt: string | null;
  store: string | null;
  productId: string | null;
  storeTransactionId: string | null;
  rcCustomerId: string | null;
  /**
   * Renovación automática desactivada, y la fecha en que se detectó. HOY NO SE GUARDA:
   * no hay columna para ella (la añadiría una migración, y SU-6b no lleva SQL). Se
   * proyecta igual porque es lo que separaría «vence y se renovará solo» de «vence y se
   * acabó», que es la diferencia entre los dos textos del aviso.
   */
  unsubscribeDetectedAt: string | null;
};

function rec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Fecha ISO no vacía, o null. RevenueCat las manda como texto ISO en la REST. */
function iso(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Proyecta el cuerpo de `GET /subscribers/{id}`. `null` = no se ha podido entender la
 * respuesta (y entonces el llamante NO escribe: no se corrige con datos que no se
 * entienden).
 */
export function projectRevenueCatSubscriber(body: unknown): SubscriberProjection | null {
  const root = rec(body);
  const sub = rec(root?.subscriber);
  if (!sub) return null;

  const rcCustomerId = str(sub.original_app_user_id);
  const entitlements = rec(sub.entitlements);
  const ent = rec(entitlements?.[PREMIUM_ENTITLEMENT_ID]);

  if (!ent) {
    // No hay entitlement PREMIUM. Ni las fechas ni la tienda significan nada.
    return {
      entitled: false,
      sandbox: false,
      expiresAt: null,
      gracePeriodExpiresAt: null,
      billingIssueAt: null,
      store: null,
      productId: null,
      storeTransactionId: null,
      rcCustomerId,
      unsubscribeDetectedAt: null,
    };
  }

  const productId = str(ent.product_identifier);
  const subscriptions = rec(sub.subscriptions);
  // La suscripción que sostiene el entitlement. Se busca por el producto que declara el
  // propio entitlement, no por el nuestro cableado: si algún día se vende otro producto,
  // esto sigue valiendo.
  const line = productId ? rec(subscriptions?.[productId]) : null;

  return {
    entitled: true,
    sandbox: line?.is_sandbox === true,
    expiresAt: iso(ent.expires_date) ?? iso(line?.expires_date),
    // La gracia puede venir en el entitlement o en la suscripción; vale cualquiera de
    // las dos, y se queda la MÁS LEJANA por el mismo motivo que `access_until` es un
    // `greatest`: la gracia da acceso (revisión de ADR-0022).
    gracePeriodExpiresAt: maxIso(
      iso(ent.grace_period_expires_date),
      iso(line?.grace_period_expires_date),
    ),
    billingIssueAt: iso(line?.billing_issues_detected_at),
    // La REST los manda en minúsculas (`app_store`) y el webhook en mayúsculas
    // (`APP_STORE`). Es la MISMA columna: se normaliza aquí o queda mezclada para
    // siempre.
    store: str(line?.store)?.toUpperCase() ?? null,
    productId,
    storeTransactionId: str(line?.store_transaction_id),
    rcCustomerId,
    unsubscribeDetectedAt: iso(line?.unsubscribe_detected_at),
  };
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Qué `billing_issue_detected_at` se escribe en una reconciliación.
 *
 * Existe porque la API no devuelve ese campo (aviso 1 de la cabecera). La regla, en
 * orden, y la dirección de cada duda elegida a propósito:
 *
 *  1. Si la API lo dice, manda la API. (El día que lo arreglen, esto se queda quieto.)
 *  2. Gracia ABIERTA → hay impago, seguro. Se conserva la fecha que ya teníamos; si no
 *     había ninguna, se sella ahora.
 *  3. Sin gracia abierta y con el vencimiento en el FUTURO → renovó: evidencia positiva
 *     de que el problema se arregló. Es el único caso en que se limpia.
 *  4. Cualquier otra cosa (vencida, sin gracia) → se conserva lo que hubiera. No se
 *     inventa un impago y, sobre todo, no se borra uno real: borrarlo sacaría la cuenta
 *     de la cabecera de la lista de candidatos, que es donde tiene que estar mientras el
 *     impago siga abierto.
 */
export function billingIssueAfterReconcile(input: {
  fromApi: string | null;
  stored: string | null;
  gracePeriodExpiresAt: string | null;
  expiresAt: string | null;
  now?: Date;
}): string | null {
  const now = (input.now ?? new Date()).getTime();
  if (input.fromApi) return input.fromApi;

  const grace = input.gracePeriodExpiresAt ? Date.parse(input.gracePeriodExpiresAt) : null;
  if (grace !== null && grace > now) {
    return input.stored ?? new Date(now).toISOString();
  }

  const expires = input.expiresAt ? Date.parse(input.expiresAt) : null;
  if (expires !== null && expires > now) return null;

  return input.stored;
}
