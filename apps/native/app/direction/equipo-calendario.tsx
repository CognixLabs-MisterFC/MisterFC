import { useLocalSearchParams } from 'expo-router';
import { CalendarioScreen } from '@/screens/family/calendario';
import { directionEventTarget } from '@/notifications/feed-target';

/**
 * D1b-4 — Calendario del equipo para DIRECCIÓN (SOLO LECTURA, `?teamId`). Reutiliza
 * `CalendarioScreen` (ya es agenda read-only) acotada por `teamId` explícito, porque
 * el scope por-usuario (`user_team_ids_in_club`) devuelve vacío a un director. El tap
 * enruta con `directionEventTarget` a rutas `/direction` (partido→convocatoria,
 * entreno→visor de sesión/detalle, resto→no navega). NO confundir con
 * `app/direction/calendario.tsx`, que es la pantalla de FESTIVOS.
 */
export default function Screen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  return <CalendarioScreen teamId={teamId ?? null} eventTarget={directionEventTarget} />;
}
