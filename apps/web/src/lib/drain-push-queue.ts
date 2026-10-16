/**
 * EL DRENADOR DE LA COLA DE PUSH, compartido por los dos crones.
 *
 * Vivía dentro de `/api/cron/reminders`, que corre `0 8 * * *`. Mientras el único
 * aviso por push fuera un recordatorio, eso bastaba. Pero el aviso de GOL perece: un
 * «GOL» que llega al día siguiente no es un aviso, es ruido. Así que ahora hay dos
 * crones y UN drenador:
 *
 *   · `/api/cron/push-drain`  — cada minuto, SOLO los tipos que caducan
 *     (`perishablePushTypes()`, hoy el gol). Es lo que hace que un gol apuntado desde
 *     la app nativa llegue a las familias sin esperar un build nuevo de la app.
 *   · `/api/cron/reminders`   — una vez al día, TODO lo que quede pendiente.
 *
 * Está en lib y no en una de las dos rutas porque importar de un route handler para
 * reutilizar su lógica es justo la forma de que acabe copiada.
 *
 * LAS FILAS QUE YA NO VALEN se marcan `skipped` en vez de dejarse `pending`: si no, se
 * releen en cada pasada y ocupan sitio del `cap`. Con el cron de cada minuto, además
 * se retiran en un minuto en vez de a las ocho de la mañana.
 */

import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseAdminClient,
  perishablePushTypes,
  pushRowIsStale,
} from '@misterfc/core';

export type DrainResult = {
  scanned: number;
  sent: number;
  skipped_user_pref: number;
  /** Filas que CADUCARON esperando en la cola (hoy solo el gol). */
  skipped_stale: number;
  failed_gone: number;
  failed_other: number;
  no_subscriptions: number;
};

export async function drainPushQueue(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  cap: number,
  opts: { onlyPerishable?: boolean; dedupePrefix?: string } = {},
): Promise<DrainResult> {
  const result: DrainResult = {
    scanned: 0,
    sent: 0,
    skipped_user_pref: 0,
    skipped_stale: 0,
    failed_gone: 0,
    failed_other: 0,
    no_subscriptions: 0,
  };

  // `created_at` entra para medir CUÁNTO LLEVA ESPERANDO la fila: hay avisos que
  // caducan en la cola (hoy el gol). Ver `pushRowIsStale` en core.
  let q = supabase
    .from('notifications')
    .select('id, user_id, type, payload, created_at')
    .eq('channel', 'push')
    .eq('status', 'pending')
    .is('sent_at', null);
  // El cron de cada minuto mira SOLO lo que caduca: es a lo que corre prisa, y así una
  // cola larga de recordatorios no le quita el sitio a un gol.
  if (opts.onlyPerishable) q = q.in('type', perishablePushTypes());
  // ACOTADO A UN AVISO (envío eager): el llamante pide "manda las filas de ESTE gol,
  // ya". El prefijo lo compone core (`goalDedupeLikePrefix`), no se escribe aquí.
  // `like` sin comodines del llamante: el prefijo se usa tal cual + '%'.
  if (opts.dedupePrefix) q = q.like('dedupe_key', `${opts.dedupePrefix}%`);
  const { data: pendings } = await q.order('created_at', { ascending: true }).limit(cap);

  if (!pendings || pendings.length === 0) return result;
  result.scanned = pendings.length;

  // Importamos lazy para que la ruta no falle en build si web-push no está
  // disponible (también nos protege en tests).
  const { sendPushToUser, pushPayloadFromNotificationRow } = await import('@/lib/web-push');

  const ahora = Date.now();

  for (const row of pendings) {
    // CADUCIDAD EN LA COLA (mitad de abajo de la frescura del gol; la de arriba está
    // en el trigger `notify_goal`, que decide si la fila se crea midiendo el reloj del
    // partido). Un «GOL» que sale horas después confunde: la pantalla del directo ya
    // enseña el marcador bueno. Se marca `skipped` —y no se deja `pending`— para que
    // no vuelva a leerse en cada pasada ni ocupe sitio del `cap`.
    if (pushRowIsStale({ type: row.type, created_at: row.created_at }, ahora)) {
      result.skipped_stale += 1;
      await supabase
        .from('notifications')
        .update({ status: 'skipped', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      continue;
    }

    const payload = pushPayloadFromNotificationRow({
      payload: row.payload,
      type: row.type,
    });
    try {
      // O2-4 — envío a web + expo. El `data` nativo sale de `row.payload` (para
      // el push, del `deep_link` se extrae el resource_id si lo hay).
      const r = await sendPushToUser(supabase, row.user_id, row.type, payload, row.payload, row.id);
      result.sent += r.sent;
      result.failed_gone += r.failed_gone;
      result.failed_other += r.failed_other;

      if (r.skipped_user_pref) {
        result.skipped_user_pref += 1;
        await supabase
          .from('notifications')
          .update({ status: 'skipped', sent_at: new Date().toISOString() })
          .eq('id', row.id);
      } else if (r.skipped_no_subscriptions) {
        result.no_subscriptions += 1;
        // Lo dejamos pending — quizá el user se suscribe mañana.
      } else if (r.sent > 0) {
        await supabase
          .from('notifications')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', row.id);
      } else if (r.failed_gone > 0 && r.failed_other === 0 && r.sent === 0) {
        // Todos los endpoints estaban muertos. Marcar failed.
        await supabase
          .from('notifications')
          .update({ status: 'failed', sent_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    } catch (e) {
      // Error INESPERADO de envío (failed_other). NO capturamos failed_gone:
      // endpoint muerto = suscripción caducada, churn normal → sería ruido.
      Sentry.captureException(e, {
        tags: { feature: 'notifications', step: 'push_send' },
      });
      result.failed_other += 1;
    }
  }

  return result;
}
