import { CalendarioScreen } from '@/screens/family/calendario';
import { staffEventTarget } from '@/notifications/feed-target';

/**
 * O2-10a — Calendario (consulta) del cuerpo técnico. Reutiliza el calendario B1
 * tal cual: `getCalendarScopeTeamIdsFromClient` (RPC `user_team_ids_in_club`) es
 * role-aware → para el staff devuelve SUS equipos.
 *
 * Bug 17 — pasa `staffEventTarget` para que las filas enruten a rutas del área
 * STAFF (entrenamiento→pasar lista, partido→convocatoria del staff) en vez de a
 * `/family/…` (que el AreaGuard rechazaba, devolviendo al inicio).
 */
export default function Screen() {
  return <CalendarioScreen eventTarget={staffEventTarget} />;
}
