/**
 * A-2 — INGESTA del webhook de Resend: qué pasó con cada correo de invitación.
 * Solo servidor (service-role).
 *
 * El agujero que cierra está descrito entero en la migración de A-1
 * (`20261107000000_a1_entrega_invitaciones.sql`): un correo a un dominio que no existe
 * se acepta, devuelve id, la pantalla dice «Invitación enviada» y nadie se entera nunca
 * de que no llegó. Faltaban las dos mitades: dónde apuntarlo (A-1) y QUIÉN lo apunta,
 * que es esto.
 *
 * LA FIRMA ES DE SVIX, NO DE RESEND. Resend delega el firmado en Svix y su propia
 * documentación remite allí para verificar a mano. Contrastado contra las dos páginas
 * vivas, no escrito de memoria:
 *   · cabeceras `svix-id`, `svix-timestamp` (unix en SEGUNDOS) y `svix-signature`
 *   · el contenido firmado es `${svix-id}.${svix-timestamp}.${CUERPO CRUDO}`
 *   · HMAC-SHA256 con la parte del secreto que va DESPUÉS de `whsec_`, y esa parte va
 *     en base64: la clave son los BYTES decodificados, no el texto
 *   · el resultado va en base64, y la cabecera puede traer VARIAS firmas separadas por
 *     espacios, cada una con su versión: `v1,<base64> v1,<base64>`. Basta con que una
 *     valga — así es como Svix rota secretos sin cortar entregas.
 *
 * El cuerpo tiene que llegar **tal y como vino**: un `JSON.parse` + `JSON.stringify`
 * cambia los bytes y tira firmas válidas. Por eso todo aquí trabaja sobre `Uint8Array`
 * y el parseo ocurre DESPUÉS de verificar. Mismo motivo y mismo patrón que SU-3.
 *
 * Se usa WebCrypto (`globalThis.crypto.subtle`) y no `node:crypto` a propósito, por lo
 * mismo que en `subscription/webhook.ts`: este módulo se exporta desde `@misterfc/core`,
 * que también empaqueta la nativa, y un `import 'node:crypto'` rompería el bundle de
 * Metro aunque nadie lo llamara. `subtle.verify` además compara en tiempo constante.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type AdminClient = SupabaseClient<Database>;

/** Las tres cabeceras de Svix. En minúsculas: `Headers.get` no distingue mayúsculas. */
export const RESEND_SIGNATURE_HEADERS = {
  id: 'svix-id',
  timestamp: 'svix-timestamp',
  signature: 'svix-signature',
} as const;

/** Ventana por defecto: 5 minutos, la que traen de serie las librerías de Svix. */
export const RESEND_SIGNATURE_TOLERANCE_SECONDS = 300;

export type ResendSignatureHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'malformed_header' | 'stale' | 'mismatch' };

/**
 * base64 → bytes. `atob` es API estándar (Node ≥16 y Hermes la traen) y no es un
 * `import`, así que no añade nada al bundle de Metro; aquí además solo corre en
 * servidor. Devuelve `null` si el texto no es base64 válido.
 */
function base64ToBytes(b64: string): Uint8Array | null {
  if (b64.length === 0) return null;
  try {
    const binary = globalThis.atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * `whsec_<base64>` → bytes de la clave. La clave son los BYTES DECODIFICADOS de la
 * parte que va después de `whsec_`, no ese texto: firmar con el texto da una firma que
 * no cuadra nunca, y es el error clásico al verificar Svix a mano.
 */
function secretBytes(signingSecret: string): Uint8Array | null {
  return base64ToBytes(
    signingSecret.startsWith('whsec_') ? signingSecret.slice(6) : signingSecret,
  );
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  // Se pasa el BUFFER y no la vista: un `Uint8Array` genérico puede estar respaldado
  // por `SharedArrayBuffer`, que no es un `BufferSource` válido para el typecheck
  // estricto de `apps/web`. Mismo apaño que en `subscription/webhook.ts`.
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/**
 * Verifica la firma sobre el cuerpo CRUDO. `now` se inyecta para poder probar la
 * ventana sin relojes falsos.
 */
export async function verifyResendSignature(
  rawBody: Uint8Array,
  headers: ResendSignatureHeaders,
  signingSecret: string,
  opts: { now?: Date; toleranceSeconds?: number } = {},
): Promise<SignatureCheck> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_header' };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: 'malformed_header' };

  // Ventana ANTES del HMAC: descartar una entrega vieja no necesita criptografía.
  const tolerance = opts.toleranceSeconds ?? RESEND_SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) return { ok: false, reason: 'stale' };

  const keyBytes = secretBytes(signingSecret);
  if (!keyBytes) return { ok: false, reason: 'malformed_header' };

  // Solo las `v1,`. Una versión que no conocemos no se intenta verificar con la receta
  // de la v1: daría `mismatch`, que es una alarma, cuando lo cierto es que no sabemos.
  const candidatas: Uint8Array[] = [];
  for (const chunk of signature.split(' ')) {
    const coma = chunk.indexOf(',');
    if (coma <= 0) continue;
    if (chunk.slice(0, coma) !== 'v1') continue;
    const bytes = base64ToBytes(chunk.slice(coma + 1));
    if (bytes) candidatas.push(bytes);
  }
  if (candidatas.length === 0) return { ok: false, reason: 'malformed_header' };

  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const signedBuffer = new ArrayBuffer(prefix.length + rawBody.length);
  const signed = new Uint8Array(signedBuffer);
  signed.set(prefix, 0);
  signed.set(rawBody, prefix.length);

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    toBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  for (const candidata of candidatas) {
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      toBuffer(candidata),
      signedBuffer,
    );
    if (valid) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}

/** Lo que nos interesa de un evento de entrega. */
export type ResendDeliveryEvent = {
  /** `data.email_id`: el id que devolvió el POST de envío. Lo que casa con la fila. */
  messageId: string;
  /** `email.bounced` → `bounced`. El prefijo se quita; el valor lo sigue poniendo Resend. */
  state: string;
  /** El porqué, cuando lo hay. `null` si el evento no trae ninguno. */
  detail: string | null;
  /** Cuándo ocurrió SEGÚN RESEND (el `created_at` del EVENTO, no el del correo). */
  at: string;
};

/**
 * Eventos que NO dicen nada sobre la ENTREGA y por eso no se registran.
 *
 * `opened` y `clicked` son de interacción y llegan DESPUÉS de `delivered`: registrarlos
 * pisaría el estado de entrega con uno que no lo es. `received` es de correo entrante,
 * que no es nuestro.
 *
 * Es una lista NEGRA y no blanca a propósito, por lo mismo que la columna no lleva CHECK
 * (A-1): si Resend estrena mañana un tipo de fallo, una lista blanca lo tiraría en
 * silencio —justo el modo de fallo que esta serie existe para cerrar—. Una lista negra
 * como mucho registra un estado de más, que se ve.
 */
export const RESEND_NON_DELIVERY_EVENTS = ['opened', 'clicked', 'received'] as const;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** El motivo, en una línea. Cortado: la columna es libre pero Sentry y la pantalla no. */
const DETAIL_MAX = 500;

function detailFrom(data: Record<string, unknown>): string | null {
  const bounce = data.bounce;
  if (bounce && typeof bounce === 'object') {
    const b = bounce as Record<string, unknown>;
    // `Permanent/Suppressed: el buzón no existe` — el tipo primero porque es lo que
    // distingue «no existe» (permanente) de «hoy no ha podido ser» (transitorio).
    const cabeza = [str(b.type), str(b.subType)].filter(Boolean).join('/');
    const cuerpo = str(b.message);
    const junto = [cabeza, cuerpo].filter(Boolean).join(': ');
    if (junto) return junto.slice(0, DETAIL_MAX);
  }
  const failed = data.failed;
  if (failed && typeof failed === 'object') {
    const reason = str((failed as Record<string, unknown>).reason);
    if (reason) return reason.slice(0, DETAIL_MAX);
  }
  return null;
}

/**
 * Parsea el cuerpo YA VERIFICADO.
 *
 * `null` significa «esto no es un evento de entrega de un correo nuestro» y NO es un
 * error: por el mismo endpoint entran eventos de contactos, de dominios y las aperturas
 * de la lista negra. El handler responde 200 igual, porque reintentarlo no cambiaría
 * nada.
 */
export function parseResendDeliveryEvent(rawBody: Uint8Array): ResendDeliveryEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = str(body.type);
  if (!type || !type.startsWith('email.')) return null;
  const state = type.slice('email.'.length);
  if (!state) return null;
  if ((RESEND_NON_DELIVERY_EVENTS as readonly string[]).includes(state)) return null;

  const data = body.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const messageId = str(d.email_id);
  if (!messageId) return null;

  // Si el evento no trae fecha se usa la de ahora. Es lo prudente: sin fecha, el candado
  // de orden del SQL la compara contra `now()` y el evento se aplica, que es lo que
  // queremos —perder un rebote por no venir fechado sería el peor desenlace—.
  const at = str(body.created_at) ?? new Date().toISOString();

  return { messageId, state, detail: detailFrom(d), at };
}

export type DeliveryIngestResult =
  | { ok: true; rows: number }
  | { ok: false; raw: unknown };

/**
 * Manda el evento al SQL, que es quien decide.
 *
 * Aquí NO se interpreta el estado: el orden (no pisar con algo más viejo) y el candado
 * de «un fallo no se tapa» viven en `apply_invitation_delivery_event`, que es lo único
 * cubierto por pgTAP. Una regla escrita en TypeScript sería una regla que solo se cumple
 * si pasas por este camino.
 *
 * `rows: 0` NO es un error: es un id que no es de ninguna invitación nuestra —otro
 * correo de la cuenta, o un envío anterior a A-2, que no guardó el id—.
 */
export async function ingestResendDeliveryEvent(
  admin: AdminClient,
  event: ResendDeliveryEvent,
): Promise<DeliveryIngestResult> {
  const { data, error } = await admin.rpc('apply_invitation_delivery_event', {
    p_message_id: event.messageId,
    p_state: event.state,
    p_detail: event.detail,
    p_at: event.at,
  });
  if (error) return { ok: false, raw: error };
  return { ok: true, rows: typeof data === 'number' ? data : 0 };
}

/**
 * ¿Se le pide a Resend que lo reintente?
 *
 * Solo si el fallo es NUESTRO. Un evento bien procesado que no casa con ninguna fila
 * está BIEN procesado: pedir reintento por eso gastaría los reintentos que harán falta
 * el día que de verdad estemos caídos.
 */
export function shouldRetryDelivery(result: DeliveryIngestResult): boolean {
  return !result.ok;
}
