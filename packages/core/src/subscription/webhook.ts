/**
 * SU-3 — INGESTA del webhook de RevenueCat. Solo servidor (service-role).
 *
 * La firma está contrastada contra su documentación viva, no escrita de memoria:
 *   · cabecera `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hmac_sha256_hex>`
 *   · el HMAC se calcula sobre `"<t>." + CUERPO CRUDO`, con la *signing secret*
 *   · hex, y comparación en tiempo constante
 *   · con tolerancia de tiempo, para que una entrega capturada no valga para siempre
 *
 * El cuerpo tiene que llegar **tal y como vino**. Un `JSON.parse` + `JSON.stringify`
 * cambia los bytes y tira firmas válidas: por eso todo lo de aquí trabaja sobre
 * `Uint8Array` y el parseo ocurre DESPUÉS de verificar.
 *
 * Se usa WebCrypto (`globalThis.crypto.subtle`) y no `node:crypto` a propósito: este
 * módulo se exporta desde `@misterfc/core`, que también empaqueta la nativa, y un
 * `import 'node:crypto'` rompería el bundle de Metro aunque nadie lo llamara.
 * `subtle.verify` además compara en tiempo constante por contrato.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/types';

type AdminClient = SupabaseClient<Database>;

export const SIGNATURE_HEADER = 'x-revenuecat-webhook-signature';

/** Ventana por defecto: 5 minutos, la que sugiere su documentación. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'malformed_header' | 'stale' | 'mismatch' };

/**
 * Verifica la firma sobre el cuerpo CRUDO. `now` se inyecta para poder probar la
 * ventana sin relojes falsos.
 */
export async function verifyRevenueCatSignature(
  rawBody: Uint8Array,
  header: string | null,
  signingSecret: string,
  opts: { now?: Date; toleranceSeconds?: number } = {},
): Promise<SignatureCheck> {
  if (!header) return { ok: false, reason: 'missing_header' };

  const parts = new Map<string, string>();
  for (const chunk of header.split(',')) {
    const eq = chunk.indexOf('=');
    if (eq > 0) parts.set(chunk.slice(0, eq).trim(), chunk.slice(eq + 1).trim());
  }
  const t = parts.get('t');
  const v1 = parts.get('v1');
  if (!t || !v1 || !/^\d+$/.test(t)) return { ok: false, reason: 'malformed_header' };

  const signature = hexToBytes(v1);
  if (!signature) return { ok: false, reason: 'malformed_header' };

  // Ventana ANTES del HMAC: descartar una entrega vieja no necesita criptografía.
  const tolerance = opts.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - Number(t)) > tolerance) return { ok: false, reason: 'stale' };

  // Se construyen sobre `ArrayBuffer` explícito y se pasan los BUFFERS, no las vistas:
  // un `Uint8Array` genérico puede estar respaldado por `SharedArrayBuffer`, que no es
  // un `BufferSource` válido, y el typecheck estricto de `apps/web` lo rechaza.
  const prefix = new TextEncoder().encode(`${t}.`);
  const signedBuffer = new ArrayBuffer(prefix.length + rawBody.length);
  const signed = new Uint8Array(signedBuffer);
  signed.set(prefix, 0);
  signed.set(rawBody, prefix.length);

  const signatureBuffer = new ArrayBuffer(signature.length);
  new Uint8Array(signatureBuffer).set(signature);

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    signatureBuffer,
    signedBuffer,
  );
  return valid ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** Lo que nos interesa del evento. El resto viaja entero en `payload`. */
export type RevenueCatEvent = {
  id: string;
  type: string;
  appUserId: string;
  eventAt: string;
  environment: string;
  store: string | null;
  productId: string | null;
  storeTransactionId: string | null;
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  rcCustomerId: string | null;
  payload: Json;
};

function msToIso(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Parsea el cuerpo ya verificado. `null` = no es un webhook de RevenueCat. */
export function parseRevenueCatEvent(rawBody: Uint8Array): RevenueCatEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const ev = body.event;
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>;

  const id = str(e.id);
  const type = str(e.type);
  const appUserId = str(e.app_user_id);
  const at = msToIso(e.event_timestamp_ms);
  if (!id || !type || !appUserId || !at) return null;

  return {
    id,
    type,
    appUserId,
    eventAt: at,
    // Si no lo dicen, se asume SANDBOX: el SQL no aplica sandbox, así que la
    // suposición prudente es la que NO da acceso.
    environment: str(e.environment) ?? 'SANDBOX',
    store: str(e.store),
    productId: str(e.product_id),
    storeTransactionId: str(e.original_transaction_id) ?? str(e.transaction_id),
    expiresAt: msToIso(e.expiration_at_ms),
    gracePeriodExpiresAt: msToIso(e.grace_period_expiration_at_ms),
    rcCustomerId: str(e.original_app_user_id) ?? appUserId,
    payload: ev as Json,
  };
}

/** Lo que devuelve `apply_subscription_event` en SQL. */
export type IngestOutcome =
  | 'applied'
  | 'duplicate'
  | 'stale'
  | 'sandbox'
  | 'unknown_profile'
  | 'deleted_profile'
  | 'transfer_to_deleted_profile';

export type IngestResult =
  | { ok: true; outcome: IngestOutcome }
  | { ok: false; raw: unknown };

/**
 * Manda el evento al SQL, que es quien decide. Aquí NO se interpreta nada del estado:
 * la idempotencia (por `id`) y el orden (aplicar solo si es más nuevo) viven en
 * `apply_subscription_event`, que es lo único cubierto por pgTAP.
 */
export async function ingestRevenueCatEvent(
  admin: AdminClient,
  event: RevenueCatEvent,
): Promise<IngestResult> {
  const { data, error } = await admin.rpc('apply_subscription_event', {
    p_event_id: event.id,
    p_type: event.type,
    p_app_user_id: event.appUserId,
    p_event_at: event.eventAt,
    p_environment: event.environment,
    p_store: event.store,
    p_product_id: event.productId,
    p_store_transaction_id: event.storeTransactionId,
    p_expires_at: event.expiresAt,
    p_grace_period_expires_at: event.gracePeriodExpiresAt,
    p_rc_customer_id: event.rcCustomerId,
    p_payload: event.payload,
  });
  if (error) return { ok: false, raw: error };
  return { ok: true, outcome: (data ?? 'applied') as IngestOutcome };
}

/**
 * Cómo se trata cada desenlace. Separado de la ingesta para poder probarlo solo, y
 * porque es donde vive la decisión que más importa de esta serie.
 *
 *  · `alert` → incidente: va a Sentry como error. SOLO el TRANSFER a cuenta borrada.
 *  · `notice` → raro pero explicable: warning. No despierta a nadie.
 *  · `normal` → funcionamiento esperado. Ni una línea.
 *
 * `deleted_profile` es **normal**, y es deliberado: las renovaciones y los reembolsos
 * van a seguir llegando durante meses para cuentas anonimizadas (BC.0 §8.4). Alertar
 * por cada una convertiría el canal de incidentes en ruido y acabaría enterrando el
 * TRANSFER, que sí es un incidente de privacidad.
 */
export type OutcomeSeverity = 'alert' | 'notice' | 'normal';

export function severityFor(outcome: IngestOutcome): OutcomeSeverity {
  switch (outcome) {
    case 'transfer_to_deleted_profile':
      return 'alert';
    case 'unknown_profile':
      return 'notice';
    case 'applied':
    case 'duplicate':
    case 'stale':
    case 'sandbox':
    case 'deleted_profile':
      return 'normal';
  }
}

/**
 * ¿Se le responde a RevenueCat que lo reintente?
 *
 * Solo si el fallo es NUESTRO. Un evento registrado y no aplicado está bien procesado:
 * devolver un 5xx haría que reintentaran 5 veces algo que funciona como debe, y
 * agotarían los reintentos que harían falta el día que de verdad estemos caídos.
 */
export function shouldRetry(result: IngestResult): boolean {
  return !result.ok;
}
