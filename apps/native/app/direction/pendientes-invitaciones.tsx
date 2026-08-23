import { useLocalSearchParams } from 'expo-router';
import { DireccionTeamInvitationsScreen } from '@/screens/direction/invitations-list';

/**
 * D2-3 nivel 2 — Listado individual de invitaciones de un equipo (SOLO LECTURA,
 * club-wide, sin detalle). Se alcanza desde el resumen por equipo
 * (`/direction/invitaciones-equipos`). `?teamId`+`?name` para un equipo; `?noTeam=1`
 * para el grupo "Sin equipo" (invitaciones sin `team_id`).
 */
export default function Screen() {
  const { teamId, name, noTeam } = useLocalSearchParams<{
    teamId?: string;
    name?: string;
    noTeam?: string;
  }>();
  const isNoTeam = noTeam === '1';
  return (
    <DireccionTeamInvitationsScreen
      teamId={isNoTeam ? null : teamId ?? null}
      teamName={isNoTeam ? null : name ?? null}
    />
  );
}
