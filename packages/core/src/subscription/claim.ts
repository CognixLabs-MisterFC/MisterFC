/**
 * SU-6b — RECLAMACIÓN: "he pagado y sigo bloqueado". Solo servidor.
 *
 * EL AGUJERO QUE TAPA, y es el peor de la serie: una familia paga, el webhook
 * `INITIAL_PURCHASE` se pierde (reintentan 5 veces y luego paran) y se queda **sin fila**
 * en `subscription_entitlements`. Sin fila no aparece en
 * `subscription_reconcile_candidates`, así que la reconciliación nocturna NO la puede
 * rescatar: preguntar por ella sería preguntar por una cuenta que no está en la lista, y
 * el candado existe justo para que eso no pase. Resultado: ha pagado y está fuera, y
 * nada automático la saca.
 *
 * POR QUÉ AQUÍ SÍ SE PUEDE PREGUNTAR. `GET /subscribers/{id}` devuelve 201 y CREA el
 * cliente si no existe, y de ahí viene el candado de SU-6a. Pero en este camino:
 *   · pregunta la propia persona por SU propia cuenta — el `profileId` sale de la sesión
 *     validada en el route handler, nunca del cuerpo de la petición;
 *   · una sesión viva significa que la cuenta no está anonimizada... y aun así se
 *     comprueba `deleted_at` y `unlinked_at` aquí, con service-role, ANTES de llamar. La
 *     sesión es un indicio; el candado es el dato.
 * Con eso, un 201 no resucita nada: es el mismo registro vacío que el SDK crea en el
 * `configure()` del primer arranque, y solo quiere decir "esta cuenta no compró nunca".
 *
 * Y NO ABRE NINGUNA PUERTA NUEVA: lo único que puede conceder acceso es lo que
 * RevenueCat responda. Quien no haya pagado recibe `no_entitlement` por más veces que
 * pulse. Sandbox tampoco cuela (la proyección lo marca y aquí se rechaza), igual que
 * `apply_subscription_event` rechaza los eventos de SANDBOX.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/types';
import { getRevenueCatCustomer, type RevenueCatConfig } from './revenuecat-api';
import { projectRevenueCatSubscriber } from './subscriber';
import { applyReconciliation } from './reconcile-sweep';
import type { SubscriptionLogger } from './deletion-sweep';
import type { IngestOutcome } from './webhook';

type AdminClient = SupabaseClient<Database>;

/**
 * Cortafuegos por cuenta. El durable es `reconciled_at` en la fila; este de memoria
 * cubre además el caso en que NO hay fila (no habría dónde apuntarlo) y es
 * *best-effort*: en serverless vale para una instancia caliente, no para todas. Con eso
 * basta para lo que protege — que nadie agote a base de pulsar la cuota REST del
 * proyecto, que es la misma que necesita el barrido nocturno.
 */
export const CLAIM_MIN_INTERVAL_MS = 60_000;

const lastClaimAt = new Map<string, number>();

/** Solo para los tests. En producción no lo llama nadie. */
export function resetClaimThrottle(): void {
  lastClaimAt.clear();
}

export type ClaimOutcome =
  /** No había fila y ahora sí: la compra estaba en RevenueCat y el webhook se perdió. */
  | 'claimed'
  /** Había fila y se ha corregido con lo que dice RevenueCat. */
  | 'corrected'
  /** Había fila y ya coincidía. Nada que hacer (y el acceso, si lo hay, ya estaba). */
  | 'already_ok'
  /** RevenueCat no tiene ninguna compra de esta cuenta. */
  | 'no_entitlement'
  /** La compra es de sandbox: no abre producción. */
  | 'sandbox'
  /** Cuenta anonimizada o desenganchada: no se pregunta y no se escribe. */
  | 'unlinked'
  /** Se ha pedido hace muy poco. */
  | 'too_soon';

export type ClaimResult =
  | { ok: true; outcome: ClaimOutcome; ingest?: IngestOutcome }
  | { ok: false; raw: unknown };

export async function claimSubscriptionFromClient(
  admin: AdminClient,
  profileId: string,
  config: RevenueCatConfig,
  deps: { logError?: SubscriptionLogger; now?: () => Date } = {},
): Promise<ClaimResult> {
  const logError = deps.logError ?? (() => {});
  const now = deps.now ?? (() => new Date());

  // ── 1. El candado, antes de tocar la red.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, deleted_at')
    .eq('id', profileId)
    .maybeSingle();
  if (profileErr) return { ok: false, raw: profileErr };
  // Sin perfil no hay a quién enlazar; anonimizado, NO se pregunta (resucitaría).
  if (!profile || profile.deleted_at !== null) return { ok: true, outcome: 'unlinked' };

  const { data: entitlement, error: entErr } = await admin
    .from('subscription_entitlements')
    .select('profile_id, unlinked_at, billing_issue_detected_at, reconciled_at')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (entErr) return { ok: false, raw: entErr };
  if (entitlement?.unlinked_at != null) return { ok: true, outcome: 'unlinked' };

  // ── 2. Cortafuegos.
  const nowMs = now().getTime();
  const memoryHit = lastClaimAt.get(profileId);
  const rowHit = entitlement?.reconciled_at ? Date.parse(entitlement.reconciled_at) : null;
  const lastTouch = Math.max(memoryHit ?? 0, rowHit ?? 0);
  if (lastTouch > 0 && nowMs - lastTouch < CLAIM_MIN_INTERVAL_MS) {
    return { ok: true, outcome: 'too_soon' };
  }
  lastClaimAt.set(profileId, nowMs);

  // ── 3. Preguntar. `assertNotDeleted` lo afirma el paso 1, aquí mismo y con
  //      service-role, no un comentario.
  const got = await getRevenueCatCustomer(profileId, config, true, { on201: 'accept' });
  if (!got.ok) {
    logError(got.raw, 'claim_customer_read', { profileId, status: got.status });
    return { ok: false, raw: got.raw };
  }

  const projection = projectRevenueCatSubscriber(got.subscriber);
  if (!projection) {
    logError(new Error('subscriber ilegible'), 'claim_projection', { profileId });
    return { ok: false, raw: got.subscriber };
  }
  if (projection.sandbox) return { ok: true, outcome: 'sandbox' };
  if (!projection.entitled) return { ok: true, outcome: 'no_entitlement' };

  // ── 4a. Ya hay fila: esto es una reconciliación a petición, por el MISMO punto común
  //       que la nocturna. Nada de una segunda regla del impago escrita aquí.
  if (entitlement) {
    const res = await applyReconciliation(admin, profileId, projection, {
      stored: entitlement.billing_issue_detected_at,
      now: now(),
    });
    if (!res.ok) {
      logError(res.raw, 'claim_reconcile', { profileId });
      return { ok: false, raw: res.raw };
    }
    if (res.outcome === 'corrected') return { ok: true, outcome: 'corrected' };
    if (res.outcome === 'noop') return { ok: true, outcome: 'already_ok' };
    return { ok: true, outcome: 'unlinked' };
  }

  // ── 4b. No hay fila: crearla. Y se crea por `apply_subscription_event`, que es el
  //       MISMO punto por el que entra un webhook, no un INSERT paralelo. Así este camino
  //       hereda entera su red: no crea perfiles, no reenlaza una cuenta borrada, el
  //       cable trampa del TRANSFER sigue puesto y la deduplicación es la PK.
  //
  //       `event_id` lleva la transacción de la tienda cuando la hay: dos reclamaciones
  //       de la MISMA compra son el mismo evento y la PK las cuenta como una.
  const eventId = `claim:${profileId}:${projection.storeTransactionId ?? new Date(nowMs).toISOString()}`;
  const { data: ingested, error: ingestErr } = await admin.rpc('apply_subscription_event', {
    p_event_id: eventId,
    p_type: 'CLAIM',
    p_app_user_id: profileId,
    // El instante de la LECTURA, no el de la compra: es la fecha de lo que sabemos. Con
    // la fecha de compra, un webhook posterior parecería viejo y se descartaría.
    p_event_at: new Date(nowMs).toISOString(),
    // Sandbox ya se ha rechazado arriba; lo que queda es producción de verdad.
    p_environment: 'PRODUCTION',
    p_store: projection.store,
    p_product_id: projection.productId,
    p_store_transaction_id: projection.storeTransactionId,
    p_expires_at: projection.expiresAt,
    p_grace_period_expires_at: projection.gracePeriodExpiresAt,
    p_rc_customer_id: projection.rcCustomerId,
    p_payload: { source: 'claim', subscriber: got.subscriber as Json } as Json,
  });
  if (ingestErr) {
    logError(ingestErr, 'claim_ingest', { profileId, eventId });
    return { ok: false, raw: ingestErr };
  }

  const outcome = (ingested ?? 'applied') as IngestOutcome;
  if (outcome !== 'applied') {
    // `duplicate` = la fila la acaba de crear otra petición (o el webhook llegó justo
    // ahora): para quien reclama, está hecho. El resto son motivos del SQL para no
    // aplicar, y se devuelven tal cual en vez de traducirse a un éxito.
    return {
      ok: true,
      outcome: outcome === 'duplicate' ? 'already_ok' : 'unlinked',
      ingest: outcome,
    };
  }

  // `apply_subscription_event` solo guarda la gracia cuando el evento es BILLING_ISSUE
  // (lo correcto para un webhook: cualquier evento de buen estado la limpia). Un CLAIM no
  // lo es, así que si RevenueCat dice que hay gracia o impago, se sella ahora con la
  // reconciliación — la fila ya existe. Se hace DESPUÉS de crear y no antes porque antes
  // no había nada que sellar; y si esto fallara, lo peor que queda es una fila sin la
  // gracia apuntada, que la pasada nocturna arregla. Antes de esta petición no tenía
  // acceso ninguno, así que no se le puede quitar nada.
  if (projection.gracePeriodExpiresAt || projection.billingIssueAt) {
    const res = await applyReconciliation(admin, profileId, projection, {
      stored: null,
      now: now(),
    });
    if (!res.ok) logError(res.raw, 'claim_grace_stamp', { profileId });
  }

  return { ok: true, outcome: 'claimed', ingest: outcome };
}
