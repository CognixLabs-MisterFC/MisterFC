import type { NotificationResponse } from 'expo-notifications';
import {
  nativeHrefForNotification,
  type NativeRouteTarget,
} from '@misterfc/core';
import { AREA_SEGMENT, type ChromeArea } from '@/nav/config';
import { availableScreensFor } from './available-screens';

/**
 * O2-4 PR-2 — Deriva el destino de navegación al TOCAR un push, según el área del
 * usuario. Lee `type` + IDs del `data` (lo que manda el emisor de PR-1) y delega
 * en el mapper puro de core. Tolerante: `data` sin `type` o sin id → Inicio /
 * listado del área (el mapper nunca peta).
 */
export function targetFromResponse(
  response: NotificationResponse,
  area: ChromeArea,
): NativeRouteTarget {
  const raw = response.notification.request.content.data;
  const data = (raw ?? {}) as Record<string, unknown>;
  const type = typeof data.type === 'string' ? data.type : '';
  return nativeHrefForNotification(
    type,
    data,
    AREA_SEGMENT[area],
    availableScreensFor(area),
  );
}
