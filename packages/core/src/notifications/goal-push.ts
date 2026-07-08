/**
 * F7B-P1 — Helpers puros para el push de GOL a los seguidores del equipo.
 *
 * El fan-out real (leer seguidores con service_role + emitNotificationFanOut)
 * vive en apps/web; aquí solo la lógica pura y testeable: el mensaje y la
 * resolución de destinatarios.
 */

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
