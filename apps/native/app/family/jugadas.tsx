import { useLocalSearchParams } from 'expo-router';
import { JugadasScreen } from '@/screens/family/jugadas';
import { ResolvePlayerTeam } from '@/ui/resolve-player-team';

/**
 * O2-5 D2 — playbook de un equipo. Desde Mi equipo llega con `teamId`; como entrada
 * de MENÚ llega sin parámetros y resolvemos el equipo del jugador activo.
 */
export default function Screen() {
  const { teamId, teamName } = useLocalSearchParams<{ teamId?: string; teamName?: string }>();
  if (teamId) return <JugadasScreen teamId={teamId} teamName={teamName ?? null} />;
  return (
    <ResolvePlayerTeam>
      {(team) => <JugadasScreen teamId={team.id} teamName={team.name} />}
    </ResolvePlayerTeam>
  );
}
