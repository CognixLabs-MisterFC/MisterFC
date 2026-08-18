import { EntrenamientosScreen } from '@/screens/family/entrenamientos';
import { ResolvePlayerTeam } from '@/ui/resolve-player-team';

/** O2 — Entrenamientos del equipo. Entrada de menú: resuelve el equipo del jugador activo. */
export default function Screen() {
  return (
    <ResolvePlayerTeam>
      {(team) => <EntrenamientosScreen teamId={team.id} teamName={team.name} />}
    </ResolvePlayerTeam>
  );
}
