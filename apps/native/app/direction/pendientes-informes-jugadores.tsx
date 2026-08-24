import { useLocalSearchParams } from 'expo-router';
import { DireccionReportPlayersScreen } from '@/screens/direction/report-players-list';

/**
 * 19-B — Segundo nivel del progreso de informes de dirección (SOLO LECTURA). Alcanzado
 * desde una fila de `pendientes-informes` (que ya lleva teamId + period + nombre). href:null
 * (no sale en la barra).
 */
export default function Screen() {
  const { teamId, period, teamName } = useLocalSearchParams<{
    teamId?: string;
    period?: string;
    teamName?: string;
  }>();
  return (
    <DireccionReportPlayersScreen
      teamId={teamId ?? ''}
      period={period ?? ''}
      teamName={teamName ?? ''}
    />
  );
}
