import { useLocalSearchParams } from 'expo-router';
import { PlantillaScreen } from '@/screens/family/plantilla';

/** O2-5 D1 — plantilla de un equipo (teamId por navegación desde Mi equipo). */
export default function Screen() {
  const { teamId, teamName } = useLocalSearchParams<{ teamId?: string; teamName?: string }>();
  return <PlantillaScreen teamId={teamId ?? null} teamName={teamName ?? null} />;
}
