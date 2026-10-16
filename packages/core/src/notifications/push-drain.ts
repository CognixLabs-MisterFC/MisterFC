/**
 * F5.7 — Lógica pura del drainer de push.
 *
 * El cron y los server actions comparten estas funciones:
 *   - `pushPayloadFromNotificationRow`: extrae title/body/deep_link/tag de
 *     una fila `notifications.payload` (jsonb) con shape conocido.
 *   - `decideNotificationOutcome`: dada la salida de `web-push send`,
 *     devuelve qué status final escribir en la fila.
 *
 * Aisladas aquí para que sean testables con vitest sin Supabase ni red.
 */

import type { Database, Json } from '../supabase/types';
import { formatGoalPush } from './goal-push';

type NotificationType = Database['public']['Enums']['notification_type'];

export type PushPayload = {
  title: string;
  body: string;
  deep_link?: string;
  tag?: string;
  /**
   * Audiencia declarada por el emisor (`audienceMark`). Viaja en la fila push
   * PARA EL DRENADOR: cuando el eager no envía, el cron lee esta fila en crudo y
   * de ahí sale el `data` del push. Ni `pushPayloadFromNotificationRow` ni el
   * contenido que ve el usuario la usan — es solo enrutado.
   */
  audience?: string;
};

/**
 * EL TEXTO DEL GOL, armado desde los INGREDIENTES del payload.
 *
 * Hay dos emisores de avisos de gol y escriben el payload distinto:
 *   · el de web (`emitGoalPush`) guarda `title`/`body` ya hechos;
 *   · el TRIGGER de la base (`notify_goal`, mig 20261126000000) guarda los
 *     ingredientes —`own`, `rival`, `team_name`, `opponent_name`— y NO la frase, para
 *     que la frase viva en un solo sitio: `formatGoalPush`, aquí al lado.
 *
 * Sin esto, un aviso nacido en el trigger se enviaría con el título por defecto y el
 * cuerpo VACÍO. Devuelve null si los ingredientes no están completos, y entonces el
 * llamador cae a los defaults de siempre: una frase a medias es peor que la genérica.
 */
function goalTextFromPayload(
  p: Record<string, unknown>,
): { title: string; body: string } | null {
  if (typeof p.own !== 'number' || typeof p.rival !== 'number') return null;
  return formatGoalPush({
    teamName: typeof p.team_name === 'string' ? p.team_name : '',
    opponentName: typeof p.opponent_name === 'string' ? p.opponent_name : null,
    own: p.own,
    rival: p.rival,
  });
}

/**
 * Saca el payload final de la fila. Si faltan campos, usa defaults
 * razonables por tipo (p.ej. title 'Mensaje nuevo' para 'new_message').
 */
export function pushPayloadFromNotificationRow(row: {
  payload: Json | null | undefined;
  type: NotificationType;
}): PushPayload {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const gol = row.type === 'goal' ? goalTextFromPayload(p) : null;
  return {
    title:
      typeof p.title === 'string'
        ? p.title
        : (gol?.title ?? defaultTitleForType(row.type)),
    body: typeof p.body === 'string' ? p.body : (gol?.body ?? ''),
    deep_link: typeof p.deep_link === 'string' ? p.deep_link : undefined,
    // El `tag` colapsa avisos consecutivos del MISMO partido, y el emisor de web lo
    // escribe (`goal:<event_id>`). El trigger no lo escribe, así que se deriva del
    // event_id: sin esto, dos goles seguidos nacidos en la base saldrían como dos
    // avisos apilados en vez de uno que sustituye al otro.
    tag:
      typeof p.tag === 'string'
        ? p.tag
        : row.type === 'goal' && typeof p.event_id === 'string'
          ? `goal:${p.event_id}`
          : row.type,
  };
}

function defaultTitleForType(type: NotificationType): string {
  switch (type) {
    case 'new_message':
      return 'Mensaje nuevo';
    case 'new_announcement':
      return 'Nuevo anuncio';
    case 'callup_published':
      return 'Convocatoria publicada';
    case 'match_callup_reminder':
      return 'Recordatorio de convocatoria';
    case 'attendance_pending_reminder':
      return 'Asistencia pendiente';
    case 'training_reminder':
      return 'Recordatorio de entrenamiento';
    case 'goal':
      return 'Gol';
    default:
      return 'MisterFC';
  }
}

export type SendOutcome = {
  sent: number;
  failed_gone: number;
  failed_other: number;
  skipped_user_pref: boolean;
  skipped_no_subscriptions: boolean;
};

export type NotificationFinalStatus =
  | { status: 'sent'; mark_sent_at: true }
  | { status: 'skipped'; mark_sent_at: true }
  | { status: 'failed'; mark_sent_at: true }
  | { status: 'pending'; mark_sent_at: false };

/**
 * Decide cómo marcar la fila `notifications` tras un intento de envío.
 *
 *   - sent > 0 (al menos un dispositivo recibió) → status='sent'.
 *   - skipped_user_pref (opt-out)                → status='skipped'.
 *   - sin subs y nada enviado                    → 'pending' (espera a que
 *                                                  el user se suscriba).
 *   - solo errores 404/410 (todos los endpoints muertos) → 'failed'.
 *   - otros errores                              → 'pending' (retry).
 */
export function decideNotificationOutcome(
  out: SendOutcome,
): NotificationFinalStatus {
  if (out.sent > 0) {
    return { status: 'sent', mark_sent_at: true };
  }
  if (out.skipped_user_pref) {
    return { status: 'skipped', mark_sent_at: true };
  }
  if (out.skipped_no_subscriptions) {
    return { status: 'pending', mark_sent_at: false };
  }
  // All-gone case: hubo intentos pero todos fueron 404/410.
  if (out.failed_gone > 0 && out.failed_other === 0) {
    return { status: 'failed', mark_sent_at: true };
  }
  // Mezcla o solo otros errores → reintento por cron.
  return { status: 'pending', mark_sent_at: false };
}

/**
 * AVISOS QUE CADUCAN EN LA COLA.
 *
 * La mitad de abajo de la regla de frescura del gol. La de arriba vive en el trigger
 * `notify_goal` (mig 20261126000000) y decide si la fila de push SE CREA, midiendo
 * con el RELOJ del partido cuánto tiempo jugado pasó entre el gol y la subida. Pero
 * una fila creada fresca puede quedarse esperando en la cola: el drenador no corre
 * continuamente, así que entre crear y enviar puede pasar de todo.
 *
 * Aquí la pregunta es otra —«¿cuánto lleva este aviso esperando?»— y para ESA sí vale
 * `notifications.created_at`, que es exactamente el momento en que se creó la fila.
 * (Para «¿cuándo ocurrió el gol?» no valía, y de ahí el reloj: la fila encolada del
 * directo no lleva la hora del toque.)
 *
 * SOLO CADUCAN LOS TIPOS QUE APARECEN AQUÍ, y hoy es uno. Un recordatorio de
 * convocatoria enviado «tarde» sigue sirviendo —el cron de las 08:00 está hecho para
 * eso—; un «GOL» que llega cuando el partido ya va 3-1 confunde, y la pantalla del
 * directo ya enseña el marcador bueno. Por eso la caducidad es por tipo y no general:
 * una regla general apagaría avisos que sí quieren llegar tarde.
 *
 * DIEZ MINUTOS para el gol: el envío eager tarda menos de un segundo, así que esta
 * ventana es para los reintentos; diez minutos todavía caen dentro del partido y dan
 * varias pasadas al drenador frecuente. Más allá, el aviso ya no es noticia.
 */
export const PUSH_TTL_MINUTES: Partial<Record<NotificationType, number>> = {
  goal: 10,
};

/**
 * Los tipos que CADUCAN, sacados del mismo mapa que los define.
 *
 * Es una lista derivada a propósito: escribirla a mano sería la segunda copia de la
 * misma regla, y el día que alguien añada un tipo perecedero al mapa se olvidaría de
 * la lista — el drenador frecuente dejaría de mirar justo el aviso que corre prisa.
 */
export function perishablePushTypes(): NotificationType[] {
  return Object.keys(PUSH_TTL_MINUTES) as NotificationType[];
}

/**
 * ¿Esta fila de push ya no vale la pena enviarla? Un tipo sin TTL NUNCA caduca.
 *
 * Una fecha ilegible o futura cuenta como NO caducada: no se puede distinguir «este
 * aviso es viejo» de «este dato está roto», y tirar un aviso legítimo por un fallo de
 * parseo es peor que mandarlo con retraso. El reloj del servidor adelantado respecto
 * al de la base entra por la misma puerta.
 */
export function pushRowIsStale(
  row: { type: NotificationType; created_at: string | null | undefined },
  nowMs: number,
): boolean {
  const ttl = PUSH_TTL_MINUTES[row.type];
  if (ttl == null) return false;
  if (!row.created_at) return false;
  const creado = Date.parse(row.created_at);
  if (Number.isNaN(creado)) return false;
  const edadMs = nowMs - creado;
  if (edadMs < 0) return false;
  return edadMs > ttl * 60_000;
}
