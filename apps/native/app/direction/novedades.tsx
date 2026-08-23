import { NovedadesScreen } from '@/screens/family/novedades';
import { directionFeedTarget } from '@/notifications/feed-target';

/**
 * O2-11a-1 — Novedades de dirección. Reuso del feed per-usuario (RLS select-own). D6:
 * pasa `directionFeedTarget` para que las filas enruten dentro de `/direction` (p. ej.
 * `erasure_requested` → /direction/supresiones) y no reboten en el AreaGuard.
 */
export default function Screen() {
  return <NovedadesScreen feedTarget={directionFeedTarget} />;
}
