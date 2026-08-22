import { useLocalSearchParams } from 'expo-router';
import { EntrenamientosScreen } from '@/screens/family/entrenamientos';

/**
 * D1b-3 — Entrenamientos del equipo para dirección (SOLO LECTURA). Reusa la lista de
 * familia por `teamId` (loader `getTeamTrainingsFromClient`, club-wide capable), pero
 * SIN la sección de asistencia (player-scoped, no aplica al director) y con los
 * destinos del detalle apuntando a `/direction`.
 */
export default function Screen() {
  const { teamId, name } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  return (
    <EntrenamientosScreen
      teamId={teamId ?? null}
      teamName={name ?? null}
      showAttendance={false}
      sessionPathname="/direction/sesion"
      trainingPathname="/direction/entrenamiento"
    />
  );
}
