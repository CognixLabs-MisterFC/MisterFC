import { useLocalSearchParams } from 'expo-router';
import { TeamStatsScreen } from '@/screens/staff/estadisticas-equipo';
import { EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * D1b-1 — Estadísticas del equipo para dirección (SOLO LECTURA). Reusa la pantalla de
 * staff, que con `teamId` es área-neutral y club-wide (`getTeamRosterStatsFromClient`;
 * la RLS de `match_player_stats` concede lectura al director). GUARDA `teamId`: sin él
 * `TeamStatsScreen` caería en su picker `MisEquiposScreen` (`getStaffTeamsFromClient`
 * → 0 para un director). En dirección siempre se llega con teamId desde el hub, pero
 * el guard lo blinda.
 */
export default function Screen() {
  const t = useTranslations('');
  const { teamId, name } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  if (!teamId) return <EmptyState message={t('equipo_detalle.pick_team')} />;
  return <TeamStatsScreen teamId={teamId} name={name ?? null} />;
}
