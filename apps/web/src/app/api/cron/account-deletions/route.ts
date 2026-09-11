/**
 * BC-6b — Endpoint cron diario del BORRADO DE CUENTA.
 *
 * Frecuencia: 1×/día, `0 3 * * *` (UTC) en `apps/web/vercel.json`. A las 3 de la
 * madrugada UTC porque no hay nadie usando la app y porque separa este job del de
 * recordatorios (`0 8 * * *`): si uno se atasca, el otro no se ve arrastrado.
 *
 * Protección: `Authorization: Bearer ${CRON_SECRET}` — el mismo secreto que ya usa
 * `/api/cron/reminders` desde F4.7. Es una variable de entorno del PROYECTO de Vercel,
 * así que no hay nada que crear: Vercel pone el header en cada entrada de
 * `vercel.json`. Sin secreto configurado, `authorized()` devuelve false y esto
 * responde 401 — falla CERRADO, y entonces el heartbeat de Sentry deja de recibir
 * check-ins y salta la alerta por AUSENCIA. Ver ADR-0008.
 *
 * Por qué es un cron PROPIO y no una pasada más de `/api/cron/reminders` (ADR-0011
 * decidió lo contrario para el drainer de push, así que conviene decir por qué aquí
 * no aplica):
 *   · El drainer comparte destinatarios y datos con los recordatorios. Esto no
 *     comparte nada: mira `account_deletion_requests` y `auth.users`.
 *   · `reminders` devuelve 500 y ABANDONA en cuanto falla cualquiera de sus consultas.
 *     Colgar de ahí el borrado significa que un bug en la query de torneos DETIENE
 *     los borrados de cuenta. Uno es una comodidad; el otro es una obligación legal
 *     (RGPD art. 17 + Apple 5.1.1 v) con una fecha límite dura de 30 días.
 *   · Alerta propia: se quiere saber que ha dejado de correr ESTE job, no el otro.
 *   · Vercel es Pro: no hay techo de dos crons.
 *
 * Dos pasadas, en este orden y sin que la segunda dependa de la primera:
 *
 *  1. PLAZO — `account_deletions_due()`: solicitudes `pending` cuya fecha límite ha
 *     llegado, o que ya no tienen ninguna supresión bloqueando. Estas se anonimizan.
 *     El camino rápido (BC-4/BC-5) y la decisión del club (BC-3) ya rematan en
 *     caliente; esta pasada es la red para todo lo demás.
 *
 *  2. BARRIDO — `account_deletions_auth_pending()`: cuentas YA anonimizadas cuya
 *     identidad de GoTrue sigue viva porque el paso 3 del finalizador falló. Va
 *     DESPUÉS a propósito: la pasada 1 puede generar justo ese estado, y así se
 *     recoge en la misma ejecución en vez de esperar a mañana.
 *
 *  3. SU-3 · REVENUECAT — `revenuecat_deletion_queue`: cuentas ya anonimizadas cuyo
 *     cliente de RevenueCat sigue existiendo. La cola la llena la propia
 *     `finalize_account_deletion`, porque borrar ese cliente es una llamada HTTP y no
 *     cabe dentro de la transacción de Postgres (ADR-0022 §4c). Va aquí y no en un cron
 *     propio porque es el MISMO dominio y el mismo horario: es el tercer efecto del
 *     borrado de cuenta, junto al avatar de Storage y la neutralización de GoTrue.
 *     Como la pasada 1 puede anonimizar cuentas nuevas, va después para recogerlas ya.
 *
 * Idempotencia: las dos primeras pasadas se apoyan en `finalize_account_deletion`, que
 * es idempotente por diseño (BC-1: si la solicitud ya está `completed`, devuelve NULL
 * sin tocar nada). La tercera también: el DELETE de RevenueCat responde 404 cuando el
 * cliente ya no está, y eso cuenta como éxito. Repetir el cron es inocuo.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { finalizeDueAccountDeletions, sweepStuckAuthNeutralizations } from '@/lib/account-deletion';
import { sweepRevenueCatDeletions } from '@/lib/subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Heartbeat vía Sentry Crons, igual que `daily-reminders`: un job que DEJA de correr
// no genera ningún error, así que lo que se vigila es la AUSENCIA de check-in. El
// monitor se auto-configura desde código (no en la UI) para que viva versionado aquí.
// slug estable = mismo monitor siempre.
const CRON_MONITOR_SLUG = 'account-deletions';
const CRON_MONITOR_CONFIG = {
  schedule: { type: 'crontab', value: '0 3 * * *' },
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
  // Vercel Cron envía GET por defecto; aceptamos ambos, como en reminders.
  return handle(req);
}

async function handle(req: Request): Promise<NextResponse> {
  // El 401 va ANTES del check-in: un curl ajeno sin el secreto NO puede contar como
  // ejecución del cron (si contara, bastaría un curl diario para silenciar la alerta).
  if (!authorized(req)) return unauthorized();

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: 'in_progress' },
    CRON_MONITOR_CONFIG,
  );

  // Cierra el heartbeat y FUERZA el envío antes de devolver: en serverless la función
  // se congela al return y el evento podría no salir nunca.
  const finish = async (status: 'ok' | 'error', response: NextResponse): Promise<NextResponse> => {
    Sentry.captureCheckIn(
      { checkInId, monitorSlug: CRON_MONITOR_SLUG, status },
      CRON_MONITOR_CONFIG,
    );
    await Sentry.flush(2000);
    return response;
  };

  try {
    // 1) Plazo cumplido / sin nada pendiente.
    const due = await finalizeDueAccountDeletions();

    // 2) Barrido de GoTrue. Va aunque la pasada 1 haya fallado en alguna fila: son
    //    colas distintas y la segunda arregla justamente lo que la primera rompe.
    const authSweep = await sweepStuckAuthNeutralizations();

    // Una cuenta que sigue atascada tras el barrido está anonimizada CON credenciales
    // vivas. `finalizeAccountDeletionWeb` ya alerta por cada una; esto avisa además de
    // que el barrido completo no las está sacando, que es un problema distinto (GoTrue
    // caído del todo, credenciales de service-role revocadas...).
    if (authSweep.failed > 0) {
      Sentry.captureMessage('account-deletions: el barrido no pudo neutralizar GoTrue', {
        level: 'error',
        tags: { cron: CRON_MONITOR_SLUG, step: 'auth_sweep' },
        extra: { ...authSweep },
      });
    }

    // 3) SU-3 · el cliente de RevenueCat de las cuentas ya anonimizadas. Independiente
    //    de las dos anteriores: su cola la llena el SQL, no estas pasadas.
    const rcSweep = await sweepRevenueCatDeletions();

    // Una supresión que el encargado de tratamiento no acepta NO se abandona nunca: se
    // sigue reintentando. Pero si lleva muchas vueltas fallando, alguien tiene que verlo.
    if (rcSweep.stuck > 0) {
      Sentry.captureMessage('account-deletions: borrados de RevenueCat atascados', {
        level: 'error',
        tags: { cron: CRON_MONITOR_SLUG, step: 'revenuecat_sweep' },
        extra: { ...rcSweep },
      });
    }

    // Cola por encima del tope: no es un fallo, pero no puede pasar desapercibido dos
    // días seguidos con una fecha límite legal de por medio.
    if (
      due.found > due.attempted ||
      authSweep.found > authSweep.attempted ||
      rcSweep.found > rcSweep.attempted
    ) {
      Sentry.captureMessage('account-deletions: quedan filas para la próxima pasada', {
        level: 'warning',
        tags: { cron: CRON_MONITOR_SLUG, step: 'backlog' },
        extra: { due, authSweep, rcSweep },
      });
    }

    return finish(
      'ok',
      NextResponse.json({ ok: true, due, auth_sweep: authSweep, revenuecat: rcSweep }),
    );
  } catch (e) {
    Sentry.captureException(e, {
      tags: { cron: CRON_MONITOR_SLUG, step: 'unexpected' },
    });
    return finish('error', NextResponse.json({ error: 'internal_error' }, { status: 500 }));
  }
}
