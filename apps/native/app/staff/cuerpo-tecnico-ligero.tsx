import { useLocalSearchParams } from 'expo-router';
import { TeamStaffScreen } from '@/screens/staff/cuerpo-tecnico';

/** O2-10a — Cuerpo técnico ligero (?teamId; sin él, selector desde Mis equipos). */
export default function Screen() {
  const { teamId, name, color } = useLocalSearchParams<{
    teamId?: string;
    name?: string;
    color?: string;
  }>();
  return <TeamStaffScreen teamId={teamId ?? null} name={name ?? null} color={color ?? null} />;
}
