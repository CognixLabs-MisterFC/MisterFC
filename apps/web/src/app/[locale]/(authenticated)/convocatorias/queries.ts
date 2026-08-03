/**
 * F4 Lote B — Queries de convocatorias.
 *
 * O2-7b-1 — La lógica de LECTURA staff (scope + lista + detalle) se extrajo a core
 * (`@misterfc/core`: `resolveConvocatoriasScopeFromClient`, `getStaffCallupsFromClient`,
 * `getStaffCallupDetailFromClient`) para compartirla con la app nativa. Este módulo
 * pasa a ser un WRAPPER fino: construye el cliente server (cookies) + el userId de la
 * sesión y delega. Mismas queries, mismo mapeo/orden → comportamiento IDÉNTICO. Los
 * tipos se re-exportan desde core (fuente única). La rama de jugador/familia (E1) ya
 * vivía en core; sigue igual.
 *
 * Permisos de lectura (los aplica el gate/scope de core, espejo de la RLS):
 *  - admin / director → todos los partidos del club.
 *  - principal / ayudante / coordinador → solo los partidos de sus teams.
 *  - jugador → partidos de sus jugadores vinculados.
 */

import {
  STAFF_ROLES,
  createSupabaseServerClient,
  getCurrentUser,
  getStaffCallupDetailFromClient,
  getStaffCallupsFromClient,
  resolveConvocatoriasScopeFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { Role } from '../jugadores/queries';

// Tipos canónicos en core (fuente única). Se re-exportan para no romper a los
// consumidores que los importan desde este módulo.
export type {
  CallupDecisionRow,
  CallupDetail,
  CallupMatchRow,
  CallupMetaRow,
  CallupPlayerRow,
  CallupResponseRow,
  ConvocatoriasScope,
} from '@misterfc/core';

const COACH_ROLES = STAFF_ROLES;

/** Cliente server (cookies) + userId de la sesión, para pasar a las funciones de core. */
async function serverCtx() {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  return { supabase, userId: user?.id ?? null };
}

export async function resolveConvocatoriasScope(clubId: string, role: Role) {
  const { supabase, userId } = await serverCtx();
  return resolveConvocatoriasScopeFromClient(supabase, { clubId, role, userId });
}

/**
 * Lista de partidos próximos con resumen de convocatoria. Delega en core.
 */
export async function loadUpcomingCallups(
  clubId: string,
  role: Role,
  rangeDays: number = 30
) {
  const { supabase, userId } = await serverCtx();
  return getStaffCallupsFromClient(supabase, {
    clubId,
    role,
    userId,
    rangeDays,
  });
}

/**
 * Detalle de una convocatoria (roster + meta + respuestas + decisiones + permisos).
 * Delega en core; devuelve null fuera de scope / evento no gestionable.
 */
export async function loadCallupDetail(
  clubId: string,
  role: Role,
  eventId: string
) {
  const { supabase, userId } = await serverCtx();
  return getStaffCallupDetailFromClient(supabase, {
    clubId,
    role,
    userId,
    eventId,
  });
}

export { COACH_ROLES };
