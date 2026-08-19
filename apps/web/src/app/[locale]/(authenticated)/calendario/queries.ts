import {
  TIMEZONE_OLA1,
  createSupabaseServerClient,
  getCalendarDataFromClient,
  getHolidaysFromClient,
  getCalendarScopeTeamIdsFromClient,
  fromZonedFields,
  type CalendarEvent,
  type TeamOption,
  type CategoryOption,
  type CalendarFilters,
  type HolidayInfo,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import {
  type LocalDay,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  parseIsoDate,
  toIsoDate,
} from '@/lib/calendar-utils';

// O2-5 B1 — la lógica de lectura del calendario (eventos/festivos/scope) y sus
// tipos viven en `@misterfc/core`; web los re-exporta para no divergir. El cálculo
// del RANGO de vista (CalendarRange/computeRange) sigue aquí (usa LocalDay). Las
// vecinas de gestión (loadEvent/loadManageableTeams/loadCanCreateSessions) NO se
// tocan.
export type { CalendarEvent, TeamOption, CategoryOption, CalendarFilters, HolidayInfo };

export type CalendarRange = {
  /** UTC inicio (inclusivo). */
  startIso: string;
  /** UTC fin (exclusivo). */
  endIso: string;
  /** LocalDay primer día visible (mes/semana). */
  firstDay: LocalDay;
  /** LocalDay último día visible. */
  lastDay: LocalDay;
};

const TZ = TIMEZONE_OLA1;

/**
 * Calcula el rango UTC que cubre la vista dada para una fecha pivote.
 * Mes: del lunes anterior al día 1 al domingo posterior al último día.
 * Semana: lun..dom de la semana pivote.
 * Agenda: 28 días empezando desde la fecha pivote.
 */
export function computeRange(
  view: 'month' | 'week' | 'agenda',
  pivot: LocalDay
): CalendarRange {
  let firstDay: LocalDay;
  let lastDay: LocalDay;
  if (view === 'month') {
    firstDay = startOfWeek(startOfMonth(pivot, TZ), TZ);
    lastDay = endOfWeek(endOfMonth(pivot, TZ), TZ);
  } else if (view === 'week') {
    firstDay = startOfWeek(pivot, TZ);
    lastDay = endOfWeek(pivot, TZ);
  } else {
    firstDay = pivot;
    // 28 días siguientes (4 semanas).
    const lastDate = new Date(
      Date.UTC(pivot.year, pivot.month, pivot.day + 27)
    );
    lastDay = parseIsoDate(
      `${lastDate.getUTCFullYear()}-${String(lastDate.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDate.getUTCDate()).padStart(2, '0')}`,
      TZ
    )!;
  }
  const startIso = fromZonedFields(
    firstDay.year,
    firstDay.month,
    firstDay.day,
    0,
    0,
    TZ
  ).toISOString();
  const endIso = fromZonedFields(
    lastDay.year,
    lastDay.month,
    lastDay.day + 1,
    0,
    0,
    TZ
  ).toISOString();
  return { firstDay, lastDay, startIso, endIso };
}

/**
 * F14F-2 — festivos del club dentro del rango visible. Los ve cualquier rol
 * (RLS holidays_select). Fechas como 'YYYY-MM-DD' (día local del club).
 */
export async function loadHolidays(
  clubId: string,
  range: CalendarRange
): Promise<HolidayInfo[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const iso = (d: LocalDay) =>
    `${d.year}-${String(d.month + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  return getHolidaysFromClient(supabase, clubId, iso(range.firstDay), iso(range.lastDay));
}

export async function loadCalendarData(
  clubId: string,
  range: CalendarRange,
  filters: CalendarFilters,
  opts?: { scopeTeamIds?: string[] | null }
): Promise<{
  events: CalendarEvent[];
  teams: TeamOption[];
  categories: CategoryOption[];
}> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  // El cálculo de vista (CalendarRange) sigue en web; la query toma solo el rango
  // ISO. Comportamiento idéntico al histórico (misma query/filtros/mapeo).
  return getCalendarDataFromClient(
    supabase,
    clubId,
    { startIso: range.startIso, endIso: range.endIso },
    filters,
    opts
  );
}

/**
 * Devuelve los teams en los que el user actual puede gestionar eventos.
 * Espejo del helper SQL `user_can_manage_event`:
 *   - admin_club / coordinador → todos los teams del club.
 *   - entrenador_principal / entrenador_ayudante → teams donde es staff activo
 *     (O2: gestionar eventos es de serie para todo el cuerpo técnico).
 *   - jugador → ninguno.
 */
/**
 * FIX-DIRECTO — IDs de los equipos del usuario en el club (para acotar la AGENDA
 * ahora que los partidos son club-wide en la RLS de events). Devuelve `null` para
 * admin (su agenda sigue club-wide, sin acotar). Para el resto —incluido el
 * coordinador (C-2a)— los equipos donde es staff o cuenta jugador/padre (helper SQL
 * user_team_ids_in_club).
 */
export async function loadCalendarScopeTeamIds(
  clubId: string,
  role: string
): Promise<string[] | null> {
  // E-7a: director club-wide como admin_club (agenda del club sin acotar; antes caía
  // en user_team_ids_in_club → [] porque no es staff/jugador/padre). El resto
  // delega el rpc a core (`getCalendarScopeTeamIdsFromClient`), que pasa p_club_id
  // y filtra vacíos igual que antes.
  if (role === 'admin_club' || role === 'director') return null;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getCalendarScopeTeamIdsFromClient(supabase, clubId);
}

export async function loadManageableTeams(
  clubId: string,
  role: string,
  teams: TeamOption[]
): Promise<{ manageableTeamIds: string[]; canManageClubEvents: boolean }> {
  if (role === 'admin_club' || role === 'coordinador') {
    return {
      manageableTeamIds: teams.map((t) => t.id),
      canManageClubEvents: true,
    };
  }
  if (role !== 'entrenador_principal' && role !== 'entrenador_ayudante') {
    return { manageableTeamIds: [], canManageClubEvents: false };
  }

  // Staff (principal o ayudante): la RLS es la verdad. Preguntamos al helper
  // user_can_manage_event por equipo (mismo patrón que canRecord en asistencia)
  // en vez de decidir por memberships.role. Desde O2 gestionar eventos es de
  // serie para todo el cuerpo técnico: cualquier staff activo del equipo (rama
  // user_is_staff_of_team de la RLS) ve el botón en sus equipos. Eventos a nivel
  // club (team_id null) solo los gestionan admin/coord, ya cubiertos arriba.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const checks = await Promise.all(
    teams.map((t) =>
      supabase
        .rpc('user_can_manage_event', { p_club_id: clubId, p_team_id: t.id })
        .then(({ data }) => (data === true ? t.id : null))
    )
  );
  const manageableTeamIds = checks.filter((id): id is string => id !== null);

  return { manageableTeamIds, canManageClubEvents: false };
}

/**
 * Carga un evento concreto (para diálogos de editar/borrar).
 * Devuelve null si no existe o RLS no lo deja ver.
 */
export async function loadEvent(eventId: string): Promise<CalendarEvent | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, category_id, type, title, notes, starts_at, ends_at,
       all_day, location_name, location_address, opponent_name, parent_event_id,
       recurrence_rule, created_by,
       cancelled_at, cancellation_source, cancellation_reason,
       approval_status, rejection_reason,
       teams(name, color, categories(name)),
       categories(name)`
    )
    .eq('id', eventId)
    .maybeSingle();

  if (!data) return null;
  const team = data.teams as unknown as {
    name: string;
    color: string;
    categories: { name: string } | null;
  } | null;
  const cat = data.categories as unknown as { name: string } | null;

  // F12.9 — ¿tiene sesión vinculada visible? (RLS = gate). Solo para trainings.
  let hasSession = false;
  if (data.type === 'training') {
    const { data: s } = await supabase
      .from('sessions')
      .select('id')
      .eq('event_id', eventId)
      .eq('is_template', false)
      .maybeSingle();
    hasSession = s != null;
  }

  return {
    id: data.id as string,
    club_id: data.club_id as string,
    team_id: (data.team_id as string | null) ?? null,
    category_id: (data.category_id as string | null) ?? null,
    type: data.type as CalendarEvent['type'],
    title: data.title as string,
    notes: (data.notes as string | null) ?? null,
    starts_at: data.starts_at as string,
    ends_at: (data.ends_at as string | null) ?? null,
    all_day: data.all_day as boolean,
    location_name: (data.location_name as string | null) ?? null,
    location_address: (data.location_address as string | null) ?? null,
    opponent_name: (data.opponent_name as string | null) ?? null,
    parent_event_id: (data.parent_event_id as string | null) ?? null,
    recurrence_rule: data.recurrence_rule,
    created_by: data.created_by as string,
    team_name: team?.name ?? null,
    team_color: team?.color ?? null,
    category_name: cat?.name ?? team?.categories?.name ?? null,
    has_session: hasSession,
    cancelled_at: (data.cancelled_at as string | null) ?? null,
    cancellation_source:
      (data.cancellation_source as CalendarEvent['cancellation_source']) ?? null,
    cancellation_reason: (data.cancellation_reason as string | null) ?? null,
    approval_status:
      (data.approval_status as CalendarEvent['approval_status']) ?? null,
    rejection_reason: (data.rejection_reason as string | null) ?? null,
  };
}

/**
 * Helper: convierte un LocalDay al ISO YYYY-MM-DD para URLs.
 */
export function dayToIsoParam(day: LocalDay): string {
  return toIsoDate(day);
}

/**
 * F12.8a — ¿puede el usuario CREAR sesiones en el club? (capacidad distinta de
 * gestionar el calendario). Gatea el botón "Planificar sesión" de un entrenamiento.
 * Vía RPC user_can_create_sessions (12.1); la RLS/action es el gate real.
 */
export async function loadCanCreateSessions(clubId: string): Promise<boolean> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data } = await supabase.rpc('user_can_create_sessions', { p_club_id: clubId });
  return data === true;
}
