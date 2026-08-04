import { CalendarioScreen } from '@/screens/family/calendario';

/**
 * O2-10a — Calendario (consulta) del cuerpo técnico. Reutiliza el calendario B1
 * tal cual: `getCalendarScopeTeamIdsFromClient` (RPC `user_team_ids_in_club`) es
 * role-aware → para el staff devuelve SUS equipos. Solo lectura (crear eventos es web).
 */
export default function Screen() {
  return <CalendarioScreen />;
}
