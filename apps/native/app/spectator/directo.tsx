import { useLocalSearchParams } from 'expo-router';
import { DirectoDetalleScreen } from '@/screens/family/directo-detalle';
import { useSpectatorPlayer } from '@/auth/spectator-player';

/**
 * O2-6 — Detalle de un directo para el SEGUIDOR. Reutiliza la pantalla de familia
 * (B2) pasándole el club del jugador seguido, `viewerIsSpectator` (nombres por
 * players_sporting) y su propio prefijo de caché. `eventId` llega por query.
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const { activePlayer } = useSpectatorPlayer();
  return (
    <DirectoDetalleScreen
      eventId={eventId ?? null}
      clubId={activePlayer?.clubId ?? null}
      viewerIsSpectator
      cacheKeyPrefix="spec-directo"
    />
  );
}
