import { useLocalSearchParams } from 'expo-router';
import { CuerpoTecnicoScreen } from '@/screens/family/cuerpo-tecnico';

/** O2-5 D1 — cuerpo técnico de un equipo (teamId/color por navegación). */
export default function Screen() {
  const { teamId, teamName, color } = useLocalSearchParams<{ teamId?: string; teamName?: string; color?: string }>();
  return <CuerpoTecnicoScreen teamId={teamId ?? null} teamName={teamName ?? null} color={color ?? null} />;
}
