import { useLocalSearchParams } from 'expo-router';
import { TeamStatsScreen } from '@/screens/staff/estadisticas-equipo';

/** O2-10a — Estadísticas de equipo (?teamId; sin él, selector desde Mis equipos). */
export default function Screen() {
  const { teamId, name } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  return <TeamStatsScreen teamId={teamId ?? null} name={name ?? null} />;
}
