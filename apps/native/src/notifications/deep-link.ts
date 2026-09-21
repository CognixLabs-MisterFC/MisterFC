import type { NotificationResponse } from 'expo-notifications';
import {
  isFamilyAudienceNotification,
  nativeTargetForNotification,
  type NativeRouteTarget,
} from '@misterfc/core';
import { AREA_SEGMENT, type ChromeArea } from '@/nav/config';
import { availableScreensFor } from './available-screens';

/**
 * O2-4 PR-2 — Deriva el destino de navegación al TOCAR un push. Lee `type` + IDs del
 * `data` (lo que manda el emisor de PR-1) y delega en el mapper puro de core.
 * Tolerante: `data` sin `type` o sin id → Inicio / listado del área (nunca peta).
 *
 * PUSH-ÁREA — el área ya NO es siempre la del rol. Un aviso cuyos destinatarios
 * salen de `player_accounts` (la convocatoria del hijo, su informe, su jugada) se
 * recibe por ser TUTOR, no por el rol de club; a un director-tutor le abría la lista
 * de convocatorias de DIRECCIÓN, club-wide y en solo lectura, donde no puede
 * responder por su hija. Qué avisos son esos y cuándo se cambia de área lo decide
 * core (`nativeTargetForNotification`), que es donde están los tests; aquí solo se
 * traducen áreas a segmentos y se aportan las pantallas de cada una.
 */
export function targetFromResponse(
  response: NotificationResponse,
  area: ChromeArea,
  /** ¿Tiene hijos vinculados? Es la MISMA puerta que abre el modo tutor en el guard. */
  hasLinkedPlayers: boolean,
): NativeRouteTarget {
  const data = dataFromResponse(response);
  const type = notificationTypeFromResponse(response);
  const tutor: ChromeArea = 'family';
  return nativeTargetForNotification(type, data, {
    homeArea: AREA_SEGMENT[area],
    homeScreens: availableScreensFor(area),
    tutorArea: hasLinkedPlayers ? AREA_SEGMENT[tutor] : null,
    tutorScreens: hasLinkedPlayers ? availableScreensFor(tutor) : null,
  });
}

/** El `data` del push como diccionario. Vacío si el emisor no mandó nada. */
function dataFromResponse(response: NotificationResponse): Record<string, unknown> {
  const raw = response.notification.request.content.data;
  return (raw ?? {}) as Record<string, unknown>;
}

/** `type` del push, o cadena vacía si no viene (el mapper lo tolera). */
export function notificationTypeFromResponse(response: NotificationResponse): string {
  const data = dataFromResponse(response);
  return typeof data.type === 'string' ? data.type : '';
}

/**
 * ¿Para enrutar ESTE push hace falta saber si el usuario tiene hijos vinculados?
 *
 * Solo lo necesitan los avisos de audiencia familia: en los demás el dato no cambia
 * la respuesta, así que esperarlo sería retrasar la navegación por nada. Mismo
 * criterio que el `AreaGuard`, que solo aguanta en "cargando" el área que depende
 * del dato y deniega el resto al instante.
 */
export function needsLinkedPlayers(response: NotificationResponse): boolean {
  return isFamilyAudienceNotification(notificationTypeFromResponse(response));
}
