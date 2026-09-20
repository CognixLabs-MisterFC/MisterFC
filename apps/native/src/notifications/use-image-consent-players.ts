import { useEffect, useState } from 'react';
import {
  imageConsentPlayerIds,
  loadImageConsentPlayersFromClient,
  NO_IMAGE_CONSENT_PLAYERS,
  type ImageConsentPlayers,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';

/**
 * Imagen-2 — Jugadores (nombre + foto firmada) de los avisos `image_consent_revoked`
 * que haya en las filas visibles del feed. Espejo del `loadImageConsentPlayers` de la
 * web, que allí es server-side.
 *
 * Va FUERA de `fetchCached` a propósito: lo que devuelve incluye una URL de Storage
 * FIRMADA con TTL corto, y una URL firmada guardada en la caché de disco se sirve
 * caducada al día siguiente — foto rota. Se pide en vivo cada vez que se pintan las
 * filas, y sin red simplemente no hay foto: el texto del aviso ya dice qué ha pasado.
 *
 * Sin avisos de este tipo (el caso normal) NO toca la red: `imageConsentPlayerIds`
 * devuelve [] y el efecto se queda en el mapa vacío compartido.
 */
export function useImageConsentPlayers(
  rows: readonly { type: string; payload: unknown }[],
): ImageConsentPlayers {
  const [players, setPlayers] = useState<ImageConsentPlayers>(NO_IMAGE_CONSENT_PLAYERS);

  // Clave estable: solo se recarga si cambian los jugadores implicados, no en cada
  // render ni por una fila nueva de otro tipo.
  const ids = imageConsentPlayerIds(rows);
  const key = ids.join(',');

  useEffect(() => {
    // Sin avisos de este tipo no se carga NADA y tampoco se toca el estado: un
    // setState síncrono dentro del efecto encadena renders (lo prohíbe el React
    // Compiler del repo). El mapa vacío se devuelve abajo, al leer.
    if (key.length === 0) return;
    let active = true;
    // IIFE + guard: el setState va TRAS el await, no síncrono en el efecto (patrón
    // que exige el React Compiler del repo).
    (async () => {
      const loaded = await loadImageConsentPlayersFromClient(supabase, key.split(','));
      if (active) setPlayers(loaded);
    })();
    return () => {
      active = false;
    };
  }, [key]);

  // Con la lista vacía se devuelve el mapa vacío aunque el estado guarde jugadores de
  // un render anterior: así una fila que ya no está en pantalla no puede pintar nada.
  return key.length === 0 ? NO_IMAGE_CONSENT_PLAYERS : players;
}
