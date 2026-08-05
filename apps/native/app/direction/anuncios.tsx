import { useLocalSearchParams } from 'expo-router';
import { TeamAnnouncementsScreen } from '@/screens/staff/anuncios';
import { DireccionAnunciosPickerScreen } from '@/screens/direction/anuncios-picker';

/**
 * O2-11a-1 — anuncios de dirección. Con ?teamId reutiliza `TeamAnnouncementsScreen`
 * (10b-1b: lista + publicar por route handler + editar/borrar). SIN teamId muestra el
 * picker CLUB-WIDE (todos los equipos del club, no el team_staff del usuario).
 */
export default function Screen() {
  const { teamId, name } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  if (!teamId) return <DireccionAnunciosPickerScreen />;
  return <TeamAnnouncementsScreen teamId={teamId} name={name ?? null} />;
}
