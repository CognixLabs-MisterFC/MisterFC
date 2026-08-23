import { DireccionInvitationTeamsScreen } from '@/screens/direction/invitation-teams-list';

/**
 * D2-3 nivel 1 — Resumen de invitaciones por equipo (SOLO LECTURA, club-wide). Destino
 * de la tarjeta "Invitaciones pendientes" del inicio de dirección; cada fila abre el
 * listado individual del equipo (`/direction/pendientes-invitaciones`).
 */
export default function Screen() {
  return <DireccionInvitationTeamsScreen />;
}
