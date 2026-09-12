/**
 * SU-6b — RECONCILIACIÓN NOCTURNA. Solo servidor (service-role + secret key).
 *
 * Preguntar a RevenueCat por el estado real y corregir nuestra proyección. Existe porque
 * los webhooks se pueden perder de verdad: reintentan 5 veces (5/10/20/40/80 min) y
 * luego **dejan de intentarlo**; y porque Google NO manda evento en la transición
 * gracia → account hold, así que una cuenta con un impago abierto puede tener nuestra
 * fila mintiendo durante semanas sin que nadie se entere.
 *
 * EL CANDADO NO ESTÁ AQUÍ, Y ES A PROPÓSITO. La lista de a quién se puede preguntar la
 * decide `subscription_reconcile_candidates` en SQL, que excluye desenganchadas y
 * anonimizadas. El motivo es que `GET /subscribers/{id}` **devuelve 201 y CREA el
 * cliente** si no existe: preguntar por una cuenta borrada la resucitaría en RevenueCat.
 * Un filtro escrito aquí sería un filtro que alguien puede quitar de un `select`; en la
 * función no se puede ni recorrer (el índice también es parcial).
 *
 * Vive en `packages/core` y no en `apps/web` por el mismo motivo que los demás barridos:
 * **`apps/web` no tiene runner de tests**, y esto es lo que hay que poder probar sin red.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getRevenueCatCustomer, type RevenueCatConfig } from './revenuecat-api';
import {
  billingIssueAfterReconcile,
  projectRevenueCatSubscriber,
  type SubscriberProjection,
} from './subscriber';
import type { SubscriptionLogger } from './deletion-sweep';

type AdminClient = SupabaseClient<Database>;

/**
 * Tope por pasada. Son llamadas HTTP de una en una y el cron tiene minutos, no horas:
 * 25 cubre de sobra el ritmo real (19 perfiles hoy) y deja el resto para la noche
 * siguiente sin que una cola larga agote la función.
 */
export const SUBSCRIPTION_RECONCILE_CAP = 25;

/** Lo que devuelve `reconcile_subscription_entitlement` en SQL. */
export type ReconcileOutcome =
  | 'corrected'
  | 'noop'
  | 'skipped_unlinked'
  | 'skipped_deleted'
  | 'unknown_profile';

export type ReconcileSweepResult = {
  found: number;
  attempted: number;
  corrected: number;
  noop: number;
  /** La fila se desengancho o se anonimizó mientras iba la petición HTTP. */
  skipped: number;
  /** Respuesta de sandbox: no se escribe NADA (ni se concede ni se revoca). */
  sandbox: number;
  /** RevenueCat no tiene entitlement PREMIUM de esta cuenta. NO se revoca; se avisa. */
  missingEntitlement: number;
  failed: number;
};

const noopLog: SubscriptionLogger = () => {};

const EMPTY: ReconcileSweepResult = {
  found: 0,
  attempted: 0,
  corrected: 0,
  noop: 0,
  skipped: 0,
  sandbox: 0,
  missingEntitlement: 0,
  failed: 0,
};

export async function reconcileSubscriptionsFromClient(
  admin: AdminClient,
  config: RevenueCatConfig,
  deps: { logError?: SubscriptionLogger; cap?: number; now?: () => Date } = {},
): Promise<ReconcileSweepResult> {
  const logError = deps.logError ?? noopLog;
  const cap = deps.cap ?? SUBSCRIPTION_RECONCILE_CAP;
  const now = deps.now ?? (() => new Date());

  const { data, error } = await admin.rpc('subscription_reconcile_candidates', {
    p_limit: cap,
  });
  if (error) {
    logError(error, 'reconcile_candidates_read');
    return { ...EMPTY };
  }

  const candidates = data ?? [];
  if (candidates.length === 0) return { ...EMPTY };

  // El `billing_issue_detected_at` que YA teníamos. Hace falta entero (no el booleano
  // que trae la lista) porque la API no devuelve ese campo y la regla es conservarlo:
  // pasar `now()` en su lugar lo empujaría un día hacia delante en cada pasada y la
  // columna acabaría diciendo "detectado hoy" de un impago de hace tres semanas.
  const { data: storedRows, error: storedErr } = await admin
    .from('subscription_entitlements')
    .select('profile_id, billing_issue_detected_at')
    .in(
      'profile_id',
      candidates.map((c) => c.profile_id),
    );

  if (storedErr) {
    // Sin esto NO se reconcilia nada: escribir con `stored = null` borraría impagos
    // reales. Perder una pasada nocturna es reparable; borrar la señal, no.
    logError(storedErr, 'reconcile_stored_read');
    return { ...EMPTY, found: candidates.length };
  }

  const stored = new Map<string, string | null>(
    (storedRows ?? []).map((r) => [r.profile_id, r.billing_issue_detected_at]),
  );

  const result: ReconcileSweepResult = { ...EMPTY, found: candidates.length };

  for (const c of candidates) {
    result.attempted += 1;

    // `assertNotDeleted` no es ceremonia: lo afirma el CANDADO del SQL, que es quien ha
    // elegido esta fila. Aquí un 201 se trata como error a propósito — significaría que
    // hemos preguntado por alguien que no existía, y eso hay que verlo en Sentry.
    const got = await getRevenueCatCustomer(c.app_user_id, config, true);
    if (!got.ok) {
      result.failed += 1;
      logError(got.raw, 'reconcile_customer_read', {
        profileId: c.profile_id,
        status: got.status,
        priority: c.priority,
      });
      continue;
    }

    const projection = projectRevenueCatSubscriber(got.subscriber);
    if (!projection) {
      result.failed += 1;
      logError(new Error('subscriber ilegible'), 'reconcile_projection', {
        profileId: c.profile_id,
      });
      continue;
    }

    if (projection.sandbox) {
      // Un entitlement de sandbox no concede acceso de producción (lo mismo que hace
      // `apply_subscription_event` con un evento de SANDBOX) y tampoco lo quita: lo que
      // dijo el webhook de producción sigue siendo lo mejor que sabemos.
      //
      // SU-8b · Y aquí sí se corta, al contrario que en la reclamación, que desde SU-8
      // pasa el entorno al SQL y deja que decida él. El motivo es que este barrido
      // escribe por `reconcile_subscription_entitlement`, que **no sabe qué es un
      // entorno**: no hay forma de decirle "esto es sandbox", así que escribiría las
      // fechas del sandbox sin preguntar y se llevaría por delante la ventana fija de 30
      // días del perfil designado. Saltar es lo único que respeta las dos cosas.
      result.sandbox += 1;
      continue;
    }

    if (!projection.entitled) {
      // RevenueCat no tiene NINGÚN entitlement PREMIUM de esta cuenta, ni vencido.
      //
      // Aquí NO se revoca, y es la decisión que más importa de este barrido. Una
      // suscripción que simplemente caducó sigue apareciendo con su `expires_date` en el
      // pasado — ese caso es el de abajo y sí se corrige. Que no aparezca en absoluto no
      // es una divergencia de fechas: es que los dos sistemas no se ponen de acuerdo en
      // que la compra exista. Un cron que cortara el acceso de una familia que paga a
      // partir de una lectura ambigua, de noche y sin que nadie lo vea, es el peor fallo
      // posible de esta serie. Se avisa y lo mira una persona.
      result.missingEntitlement += 1;
      logError(new Error('RevenueCat no tiene entitlement de esta cuenta'), 'reconcile_no_entitlement', {
        profileId: c.profile_id,
        accessUntil: c.access_until,
        billingIssue: c.billing_issue,
      });
      continue;
    }

    const outcome = await applyReconciliation(admin, c.profile_id, projection, {
      stored: stored.get(c.profile_id) ?? null,
      now: now(),
    });

    if (!outcome.ok) {
      result.failed += 1;
      logError(outcome.raw, 'reconcile_apply', { profileId: c.profile_id });
      continue;
    }

    switch (outcome.outcome) {
      case 'corrected':
        result.corrected += 1;
        break;
      case 'noop':
        result.noop += 1;
        break;
      default:
        // skipped_unlinked · skipped_deleted · unknown_profile — la fila cambió mientras
        // iba la petición. No es un fallo: es el candado funcionando.
        result.skipped += 1;
        break;
    }
  }

  return result;
}

export type ApplyReconciliationResult =
  | { ok: true; outcome: ReconcileOutcome }
  | { ok: false; raw: unknown };

/**
 * Manda a SQL lo que dijo RevenueCat. Compartido con el endpoint de reclamación
 * (`claim`), que es el MISMO punto común: si algún día cambia la regla del impago, no
 * hay dos sitios donde cambiarla.
 */
export async function applyReconciliation(
  admin: AdminClient,
  profileId: string,
  projection: SubscriberProjection,
  ctx: { stored: string | null; now?: Date },
): Promise<ApplyReconciliationResult> {
  const billingIssueAt = billingIssueAfterReconcile({
    fromApi: projection.billingIssueAt,
    stored: ctx.stored,
    gracePeriodExpiresAt: projection.gracePeriodExpiresAt,
    expiresAt: projection.expiresAt,
    now: ctx.now,
  });

  const { data, error } = await admin.rpc('reconcile_subscription_entitlement', {
    p_profile_id: profileId,
    p_expires_at: projection.expiresAt,
    p_grace_period_expires_at: projection.gracePeriodExpiresAt,
    p_billing_issue_at: billingIssueAt,
    p_store: projection.store,
    p_product_id: projection.productId,
    p_store_transaction_id: projection.storeTransactionId,
    p_rc_customer_id: projection.rcCustomerId,
  });
  if (error) return { ok: false, raw: error };
  return { ok: true, outcome: (data ?? 'noop') as ReconcileOutcome };
}
