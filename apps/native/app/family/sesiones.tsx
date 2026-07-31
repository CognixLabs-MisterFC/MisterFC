import { useLocalSearchParams } from 'expo-router';
import { SesionesScreen } from '@/screens/family/sesiones';

/** O2-5 D1 — sesiones publicadas de un equipo (teamId por navegación). */
export default function Screen() {
  const { teamId, teamName } = useLocalSearchParams<{ teamId?: string; teamName?: string }>();
  return <SesionesScreen teamId={teamId ?? null} teamName={teamName ?? null} />;
}
