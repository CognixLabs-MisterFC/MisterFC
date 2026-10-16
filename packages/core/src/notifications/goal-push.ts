/**
 * F7B-P1 — Helpers puros para el push de GOL a los seguidores del equipo.
 *
 * El fan-out real (leer seguidores con service_role + emitNotificationFanOut)
 * vive en apps/web; aquí solo la lógica pura y testeable: el mensaje y la
 * resolución de destinatarios.
 */

import { isMatchGoal } from '../match/score';

/** Marcador con NUESTRO equipo como local (side='own' → own; rival → rival). */
export type GoalPushInput = {
  teamName: string;
  opponentName: string | null;
  own: number;
  rival: number;
};

export type GoalPushMessage = { title: string; body: string };

/**
 * "Gol" + "{Local N - M Visitante}", con el marcador YA actualizado tras el gol.
 * Ej: title "Gol", body "Fonteta 1 - 0 Valencia" (marca nuestro equipo) o
 * "Fonteta 1 - 1 Valencia" (marca el rival). NUESTRO equipo es siempre el local
 * (izquierda); no se nombra quién marcó, basta el marcador nuevo. Si no hay rival
 * nombrado, se omite sin dejar espacio colgando.
 */
export function formatGoalPush(input: GoalPushInput): GoalPushMessage {
  const team = input.teamName.trim();
  const opp = (input.opponentName ?? '').trim();
  const scoreline = `${team} ${input.own} - ${input.rival}${opp ? ` ${opp}` : ''}`;
  return { title: 'Gol', body: scoreline };
}

/**
 * La BASE de la `dedupe_key` de un aviso de gol, que es también el PREFIJO por el
 * que se encuentran las dos filas (campana y push) de ese gol.
 *
 * Existe porque el formato está escrito en DOS sitios que no se pueden refactorizar
 * juntos: el trigger `notify_goal` lo concatena en SQL (`'goal:' || new.id || ':' ||
 * profile_id || ':push'`) y el emisor de web lo pasa como `dedupe_base_prefix`. El bus
 * le añade `:<user_id>:<channel>`. Con `notifications_dedupe_unique` encima, tiene que
 * coincidir CARÁCTER a CARÁCTER o los dos emisores duplicarían el aviso.
 *
 * El tercer sitio que lo necesita es el envío eager del gol de la app nativa, que busca
 * las filas de UN gol por prefijo. Ese tercero ya no lo escribe: lo pide aquí.
 *
 * OJO, no es el formato de `buildDedupeKey` (`<type>:<channel>:<event>:<día>:<user>`),
 * que es el de los recordatorios del cron. Conviven dos formatos en la tabla.
 */
export function goalDedupeBasePrefix(goalRowId: string): string {
  return `goal:${goalRowId}`;
}

/**
 * Lo que hay que poner delante de un `like` para encontrar las filas de ESE gol y de
 * ningún otro. Los dos puntos finales NO son adorno: sin ellos, el id de un gol que
 * sea prefijo de otro arrastraría filas ajenas.
 */
export function goalDedupeLikePrefix(goalRowId: string): string {
  return `${goalDedupeBasePrefix(goalRowId)}:`;
}

/**
 * Destinatarios del push de gol: los seguidores del equipo, deduplicados, sin
 * entradas vacías y EXCLUYENDO a quien registró el gol (no auto-notificar al
 * staff que graba).
 */
export function resolveGoalRecipients(
  followerProfileIds: readonly (string | null | undefined)[],
  recorderProfileId: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of followerProfileIds) {
    if (!id || id === recorderProfileId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * LA DECISIÓN DEL EMPUJÓN — qué se hace cuando alguien pide «manda ya el push de este
 * gol» (`POST /api/directo/goal-push`).
 *
 * Vive aquí, y no en el route handler, porque `apps/web` no tiene suite: dentro del
 * handler esta regla no se podría poner roja, y es justo la parte que decide quién
 * puede disparar un envío. Mismo motivo por el que `lineupEmptyAction` salió de la
 * pantalla de nativa.
 *
 * `row` null es a la vez «no existe» y «existe y no es tuyo»: con la RLS delante y el
 * JWT del usuario, el handler no puede distinguirlas, así que las dos son `forbidden`.
 *
 * EL ORDEN IMPORTA, y no por elegancia: la propiedad se comprueba ANTES del tipo. Al
 * revés, pedir una fila ajena devolvería `not_a_goal` o `forbidden` según lo que esa
 * fila fuese, y eso cuenta algo de una fila que no se puede ver.
 */
export type GoalPushRequestDecision = 'send' | 'forbidden' | 'not_a_goal';

export function goalPushRequestDecision(input: {
  row: { created_by: string; type: string; outcome?: string | null } | null;
  callerProfileId: string;
}): GoalPushRequestDecision {
  const { row, callerProfileId } = input;
  if (!row || !callerProfileId || row.created_by !== callerProfileId) return 'forbidden';
  if (!isMatchGoal({ type: row.type, outcome: row.outcome ?? null })) return 'not_a_goal';
  return 'send';
}
