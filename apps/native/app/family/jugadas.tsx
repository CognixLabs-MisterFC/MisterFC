import { useLocalSearchParams } from 'expo-router';
import { JugadasScreen } from '@/screens/family/jugadas';

/** O2-5 D2 — playbook de un equipo (teamId por navegación desde Mi equipo). */
export default function Screen() {
  const { teamId, teamName } = useLocalSearchParams<{ teamId?: string; teamName?: string }>();
  return <JugadasScreen teamId={teamId ?? null} teamName={teamName ?? null} />;
}
