/**
 * SU-6b — Endpoint cron diario de la SUSCRIPCIÓN.
 *
 * Frecuencia: 1×/día, `0 4 * * *` (UTC) en `apps/web/vercel.json`. A las 4, una hora
 * después del de borrado de cuenta: si el de borrado anonimiza cuentas y desengancha sus
 * entitlements, esta pasada ya las ve fuera de la lista de candidatos.
 *
 * Protección: `Authorization: Bearer ${CRON_SECRET}`, el mismo secreto de proyecto que
 * usan `reminders` y `account-deletions`. Sin secreto configurado responde 401 — falla
 * CERRADO, y entonces el heartbeat deja de llegar y salta la alerta por AUSENCIA
 * (ADR-0008).
 *
 * POR QUÉ ES UN CRON PROPIO y no dos pasadas más del de borrado de cuenta, que ya lleva
 * el drenado de RevenueCat (SU-3):
 *   · Aquel es del dominio del BORRADO. El drenado vive ahí porque su cola la llena
 *     `finalize_account_deletion`: es un efecto del borrado, no de la suscripción. Esto
 *     no tiene nada que ver con borrarse.
 *   · Alerta propia: interesa saber que ha dejado de correr ESTO, no lo otro. Un fallo
 *     de la reconciliación es "hay filas mintiendo"; uno del borrado es un plazo legal.
 *   · Y sobre todo: el de borrado tiene una fecha límite dura (RGPD art. 17 + Apple
 *     5.1.1 v). Colgarle dos pasadas que hacen llamadas HTTP de una en una a RevenueCat
 *     es meterle tiempo de ejecución y motivos de fallo ajenos a una obligación legal.
 *   · Vercel es Pro: no hay techo de crons.
 *
 * Dos pasadas, en este orden, y la segunda NO depende de la primera:
 *
 *  1. RECONCILIAR — `subscription_reconcile_candidates` → `GET /subscribers` →
 *     `reconcile_subscription_entitlement`. Corrige nuestra proyección con lo que dice
 *     RevenueCat. Prioriza los impagos abiertos, que son el único sitio donde la verdad
 *     puede divergir durante SEMANAS: Google no manda ningún evento en la transición
 *     gracia → account hold.
 *
 *  2. AVISAR — `notify_subscription_expiring`: a quien paga y le vence en <= 7 días. Va
 *     DESPUÉS a propósito, para avisar con las fechas ya corregidas y no con las viejas.
 *     Pero va AUNQUE la primera falle: un aviso con la fecha de ayer sigue siendo mejor
 *     que ningún aviso, y la clave de dedupe lleva la fecha, así que si la
 *     reconciliación la corrige mañana se avisará de la nueva.
 *
 * Idempotencia: la pasada 1 es un `update` con lo que responde RevenueCat (repetirla no
 * cambia nada y solo deja rastro en `subscription_events` cuando CORRIGE algo); la 2
 * deduplica por `dedupe_key` con la fecha de vencimiento dentro. Repetir el cron es
 * inocuo.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { notifySubscriptionExpiring, reconcileSubscriptions } from '@/lib/subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_MONITOR_SLUG = 'subscriptions';
const CRON_MONITOR_CONFIG = {
  schedule: { type: 'crontab', value: '0 4 * * *' },
  timezone: 'UTC',
  checkinMargin: 15,
  maxRuntime: 5,
} as const;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron envía GET por defecto; se aceptan los dos, como en los otros crons.
  return handle(req);
}

async function handle(req: Request): Promise<NextResponse> {
  // El 401 ANTES del check-in: un curl ajeno sin el secreto no puede contar como
  // ejecución del cron y silenciar la alerta por ausencia.
  if (!authorized(req)) return unauthorized();

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: 'in_progress' },
    CRON_MONITOR_CONFIG,
  );

  const finish = async (status: 'ok' | 'error', response: NextResponse): Promise<NextResponse> => {
    Sentry.captureCheckIn(
      { checkInId, monitorSlug: CRON_MONITOR_SLUG, status },
      CRON_MONITOR_CONFIG,
    );
    await Sentry.flush(2000);
    return response;
  };

  try {
    // 1) Reconciliar.
    const reconcile = await reconcileSubscriptions();

    // RevenueCat no tiene entitlement de una cuenta que para nosotros sí paga. NO se le
    // corta el acceso (ver `reconcileSubscriptionsFromClient`): se avisa para que lo
    // mire una persona, porque cortar de noche a quien ha pagado es el peor fallo
    // posible de esta serie.
    if (reconcile.missingEntitlement > 0) {
      Sentry.captureMessage('subscriptions: RevenueCat no reconoce entitlements que tenemos', {
        level: 'error',
        tags: { cron: CRON_MONITOR_SLUG, step: 'reconcile_missing' },
        extra: { ...reconcile },
      });
    }

    if (reconcile.failed > 0) {
      Sentry.captureMessage('subscriptions: la reconciliación no pudo con algunas cuentas', {
        level: 'warning',
        tags: { cron: CRON_MONITOR_SLUG, step: 'reconcile_failed' },
        extra: { ...reconcile },
      });
    }

    // Cola por encima del tope: mañana se sigue. No es un fallo, pero si pasa varios
    // días seguidos significa que el tope se ha quedado corto.
    if (reconcile.found > reconcile.attempted) {
      Sentry.captureMessage('subscriptions: quedan cuentas por reconciliar', {
        level: 'warning',
        tags: { cron: CRON_MONITOR_SLUG, step: 'reconcile_backlog' },
        extra: { ...reconcile },
      });
    }

    // 2) Avisar. Independiente: corre aunque la pasada 1 haya fallado entera.
    const notice = await notifySubscriptionExpiring();
    if (!notice.ok) {
      Sentry.captureException(notice.raw, {
        tags: { cron: CRON_MONITOR_SLUG, step: 'expiring_notice' },
      });
    }

    return finish(
      'ok',
      NextResponse.json({
        ok: true,
        reconcile,
        notified: notice.ok ? notice.notified : null,
      }),
    );
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: CRON_MONITOR_SLUG, step: 'unexpected' } });
    return finish('error', NextResponse.json({ error: 'internal_error' }, { status: 500 }));
  }
}
