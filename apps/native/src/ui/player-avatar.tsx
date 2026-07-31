import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import {
  getPlayerPhotoPathFromClient,
  signPlayerPhotoFromClient,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useIsOnline } from '@/data/connectivity';

/**
 * O2-5 C2 — Avatar del jugador. La foto es la cara de un MENOR: NO se cachea. Se
 * firma bajo demanda (URL de TTL corto del bucket privado) y SOLO online; sin
 * conexión o sin foto cae a las iniciales sobre el color del club.
 *
 * Dos modos: `path` (ruta ya conocida en `players.photo_url`, p.ej. la ficha ya la
 * trae) o `playerId` (resuelve la ruta él mismo, para pantallas cuyo fetch no la
 * incluye, p.ej. mi-informe). En ambos casos la firma es efímera y online-only.
 */
export function PlayerAvatar({
  path,
  playerId,
  initials,
  accent,
  size = 56,
}: {
  path?: string | null;
  playerId?: string;
  initials: string;
  accent: string;
  size?: number;
}) {
  const online = useIsOnline();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      // setState solo dentro del callback async (no en el cuerpo del efecto) →
      // compatible con la regla react-hooks/set-state-in-effect.
      let signed: string | null = null;
      if (online) {
        const resolvedPath =
          path !== undefined
            ? path
            : playerId
              ? await getPlayerPhotoPathFromClient(supabase, playerId)
              : null;
        signed = resolvedPath ? await signPlayerPhotoFromClient(supabase, resolvedPath) : null;
      }
      if (active) setUrl(signed);
    })();
    return () => {
      active = false;
    };
  }, [path, playerId, online]);

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, backgroundColor: accent }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Text className="font-bold text-white" style={{ fontSize: size * 0.32 }}>
          {initials.toUpperCase() || '·'}
        </Text>
      )}
    </View>
  );
}
