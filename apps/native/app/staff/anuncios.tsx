import { useLocalSearchParams } from 'expo-router';
import { TeamAnnouncementsScreen } from '@/screens/staff/anuncios';

/**
 * O2-10b-1b — anuncios del equipo (?teamId). Sin teamId, la pantalla muestra el
 * picker de equipos (MisEquiposScreen). Publicar → route handler; editar/borrar → RLS.
 */
export default function Screen() {
  const { teamId, name } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  return <TeamAnnouncementsScreen teamId={teamId ?? null} name={name ?? null} />;
}
