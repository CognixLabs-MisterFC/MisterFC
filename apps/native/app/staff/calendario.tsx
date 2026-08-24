import { CalendarShell } from '@/screens/family/calendario-shell';
import { staffEventTarget } from '@/notifications/feed-target';

/**
 * O2-10a / 18-F3b — Calendario (consulta) del cuerpo técnico. Ahora con las MISMAS 2
 * pestañas que familia vía `CalendarShell`: "Próximos eventos" (la agenda de siempre,
 * idéntica) + "Temporada" (MES/DÍA). Sin `teamId` ni `clubWide` → scope de staff de
 * siempre (`user_team_ids_in_club`, role-aware → SUS equipos); la caché es la misma
 * `calendar`/`calendar-month` (club-scoped, mismo scope por-usuario que familia para ese
 * usuario en ese club).
 *
 * `teamFilter` activo: el filtro de equipos solo se muestra si el scope trae >1 equipo →
 * al entrenador de un solo equipo NO le aparece; al coordinador (varios equipos) sí.
 *
 * Bug 17 — `staffEventTarget` para que las filas enruten a rutas del área STAFF
 * (entrenamiento→pasar lista, partido→convocatoria del staff) en vez de a `/family/…`.
 */
export default function Screen() {
  return <CalendarShell eventTarget={staffEventTarget} teamFilter />;
}
