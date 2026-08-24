import { useLocalSearchParams } from 'expo-router';
import { DireccionReportPlayersScreen } from '@/screens/direction/report-players-list';

/**
 * 19-C — 2º nivel de Informes del entrenador (SOLO LECTURA): jugadores del equipo con su
 * estado. Alcanzado desde el picker del dispatcher cuando hay >1 equipo (lleva teamId +
 * period + nombre). Reutiliza la pantalla presentacional compartida con dirección. href:null.
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
