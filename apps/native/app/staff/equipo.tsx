import { useLocalSearchParams } from 'expo-router';
import { TeamDetailScreen } from '@/screens/staff/equipo-detalle';
import { MisEquiposScreen } from '@/screens/staff/mis-equipos';

/**
 * O2-10a — Pestaña "Equipo". Con teamId (llegado desde "Mis equipos") muestra el
 * detalle; sin teamId es la lista de "Mis equipos" (entrada → tocar equipo).
 */
export default function Screen() {
  const { teamId, name, color } = useLocalSearchParams<{
    teamId?: string;
    name?: string;
    color?: string;
  }>();
  if (!teamId) return <MisEquiposScreen target="detail" />;
  return <TeamDetailScreen teamId={teamId} name={name ?? null} color={color ?? null} />;
}
