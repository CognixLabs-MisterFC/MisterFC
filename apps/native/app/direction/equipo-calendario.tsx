import { useLocalSearchParams } from 'expo-router';
import { CalendarShell } from '@/screens/family/calendario-shell';
import { directionEventTarget } from '@/notifications/feed-target';

/**
 * D1b-4 / 18-F3c — Calendario del equipo para DIRECCIÓN (SOLO LECTURA, `?teamId`). Ahora
 * con las 2 pestañas vía `CalendarShell`: "Próximos eventos" (la agenda de siempre) +
 * "Temporada" (MES/DÍA), ambas acotadas a ESE equipo (`teamId`, NO clubWide → el scope
 * por-usuario da vacío a un director; con teamId se filtra a ese equipo). Sin filtro de
 * equipos (es un solo equipo). El tap enruta con `directionEventTarget`. NO confundir con
 * `app/direction/calendario.tsx` (lanzadera) ni `calendario-festivos.tsx` (festivos).
 */
export default function Screen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  return <CalendarShell teamId={teamId ?? null} eventTarget={directionEventTarget} />;
}
