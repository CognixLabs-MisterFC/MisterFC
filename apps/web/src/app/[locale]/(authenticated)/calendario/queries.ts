import {
  TIMEZONE_OLA1,
  createSupabaseServerClient,
  teamsInActiveSeason,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import {
  type LocalDay,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  parseIsoDate,
  toIsoDate,
} from '@/lib/calendar-utils';
import { fromZonedFields } from '@misterfc/core';

export type CalendarEvent = {
  id: string;
  club_id: string;
  team_id: string | null;
  category_id: string | null;
  type: 'training' | 'match' | 'tournament' | 'friendly' | 'other';
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location_name: string | null;
  location_address: string | null;
  opponent_name: string | null;
  parent_event_id: string | null;
  recurrence_rule: unknown;
  created_by: string;
  /** Embebido vía join: nombre y color del equipo (si existe). */
  team_name: string | null;
  team_color: string | null;
  category_name: string | null;
  /** F12.9 — el entrenamiento tiene una sesión vinculada que el usuario PUEDE
   *  VER (RLS de 12.1: staff ve cualquiera del club; jugador/familia solo si está
   *  publicada). Solo aplica a type='training'; en el resto es false. */
  has_session: boolean;
};

export type TeamOption = {
  id: string;
  name: string;
  color: string;
  category_id: string;
  category_name: string;
  season: string;
  /** F4.9 — duración por tiempo (min) de la categoría del team. */
  half_duration_minutes: number;
};

export type CategoryOption = {
  id: string;
  name: string;
  /** F4.9 — duración por tiempo (min) de la categoría. */
  half_duration_minutes: number;
};

export type CalendarFilters = {
  teamIds: string[];
  categoryIds: string[];
  types: string[];
};

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

  let query = supabase
    .from('events')
    .select(
      `id, club_id, team_id, category_id, type, title, notes, starts_at, ends_at,
       all_day, location_name, location_address, opponent_name, parent_event_id,
       recurrence_rule, created_by,
       teams(name, color, categories(name)),
       categories(name)`
    )
    .eq('club_id', clubId)
    .gte('starts_at', range.startIso)
    .lt('starts_at', range.endIso)
    .order('starts_at', { ascending: true });

  // FIX-DIRECTO — Acota la AGENDA a los equipos del usuario (+ eventos de club,
  // team_id null). Necesario porque los PARTIDOS ahora son club-wide en la RLS de
  // events (para el directo): sin este filtro, a un jugador/padre se le colarían
  // en el calendario los partidos de OTROS equipos. Para admin/coord el caller
  // pasa scopeTeamIds=null → agenda club-wide, sin cambios. La agenda del seguidor
  // ya pasa teamIds explícito (F14C-4), así que no depende de esto.
  if (opts?.scopeTeamIds != null) {
    const scope = opts.scopeTeamIds;
    if (scope.length > 0) {
      query = query.or(`team_id.in.(${scope.join(',')}),team_id.is.null`);
    } else {
      query = query.is('team_id', null);
    }
  }

  if (filters.teamIds.length > 0) {
    query = query.in('team_id', filters.teamIds);
  }
  if (filters.categoryIds.length > 0) {
    query = query.in('category_id', filters.categoryIds);
  }
  if (filters.types.length > 0) {
    query = query.in('type', filters.types);
  }

  const { data: rawEvents } = await query;

  type RawTeam = {
    name: string;
    color: string;
    categories: { name: string } | null;
  };
  type RawCategory = { name: string };

  const events: CalendarEvent[] = (rawEvents ?? []).map((e) => {
    const team = e.teams as unknown as RawTeam | null;
    const cat = e.categories as unknown as RawCategory | null;
    return {
      id: e.id as string,
      club_id: e.club_id as string,
      team_id: (e.team_id as string | null) ?? null,
      category_id: (e.category_id as string | null) ?? null,
      type: e.type as CalendarEvent['type'],
      title: e.title as string,
      notes: (e.notes as string | null) ?? null,
      starts_at: e.starts_at as string,
      ends_at: (e.ends_at as string | null) ?? null,
      all_day: e.all_day as boolean,
      location_name: (e.location_name as string | null) ?? null,
      location_address: (e.location_address as string | null) ?? null,
      opponent_name: (e.opponent_name as string | null) ?? null,
      parent_event_id: (e.parent_event_id as string | null) ?? null,
      recurrence_rule: e.recurrence_rule,
      created_by: e.created_by as string,
      team_name: team?.name ?? null,
      team_color: team?.color ?? null,
      category_name: cat?.name ?? team?.categories?.name ?? null,
      has_session: false,
    };
  });

  // F12.9 — marca los entrenamientos con sesión vinculada VISIBLE para el usuario.
  // La RLS de `sessions` (12.1) es el filtro: el staff ve las del club; el
  // jugador/familia solo las publicadas (visibility='team'). Un único lookup.
  const trainingIds = events
    .filter((e) => e.type === 'training')
    .map((e) => e.id);
  const plannedIds = await loadPlannedEventIds(supabase, trainingIds);
  for (const e of events) {
    if (plannedIds.has(e.id)) e.has_session = true;
  }

  // Teams + categories del club para los selectores de filtro y dialog.
  const { data: rawTeams } = await supabase
    .from('teams')
    .select(
      'id, name, color, season, category_id, categories!inner(name, club_id, half_duration_minutes)',
    )
    .order('name');

  const allTeams: TeamOption[] = (rawTeams ?? [])
    .map((t) => {
      const cat = t.categories as unknown as {
        name: string;
        club_id: string;
        half_duration_minutes: number;
      };
      return {
        id: t.id as string,
        name: t.name as string,
        color: t.color as string,
        category_id: t.category_id as string,
        category_name: cat.name,
        season: t.season as string,
        club_id: cat.club_id,
        half_duration_minutes: cat.half_duration_minutes ?? 45,
      };
    })
    .filter((t) => t.club_id === clubId)
    .map((t) => {
      const { club_id, ...rest } = t;
      void club_id;
      return rest;
    });

  // Bug-1: selectores/diálogo del calendario son operativos → solo la temporada
  // activa (sin duplicados del rollover). Los nombres de equipo de cada evento
  // vienen del embed del propio evento, así que el histórico se sigue mostrando.
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const teams: TeamOption[] = teamsInActiveSeason(allTeams, activeSeason);

  // Rework A (A4) — la categoría es una plantilla permanente sin temporada. El
  // selector de categoría del calendario ya no muestra/ordena por season (la
  // temporada vive en el equipo); el filtro sigue siendo por category_id.
  const { data: rawCategories } = await supabase
    .from('categories')
    .select('id, name, half_duration_minutes')
    .eq('club_id', clubId)
    .order('name');

  const categories: CategoryOption[] = (rawCategories ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    half_duration_minutes: (c.half_duration_minutes as number | null) ?? 45,
  }));

  return { events, teams, categories };
}

/**
 * F12.9 — IDs de eventos (entrenamientos) que tienen una sesión REAL vinculada
 * VISIBLE para el usuario actual. RLS-aware: confía en la RLS de `sessions` (12.1)
 * — el staff ve las del club, el jugador/familia solo las publicadas. Un solo
 * SELECT acotado a los ids pasados; devuelve el conjunto presente.
 */
async function loadPlannedEventIds(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  eventIds: string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const { data } = await supabase
    .from('sessions')
    .select('event_id')
    .in('event_id', eventIds)
    .eq('is_template', false);
  return new Set(
    (data ?? [])
      .map((r) => r.event_id as string | null)
      .filter((id): id is string => id != null)
  );
}

/**
 * Devuelve los teams en los que el user actual puede gestionar eventos.
 * Espejo del helper SQL `user_can_manage_event`:
 *   - admin_club / coordinador → todos los teams del club.
 *   - entrenador_principal → teams donde es staff activo.
 *   - entrenador_ayudante con can_manage_calendar → teams donde es staff.
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
  if (role === 'admin_club') return null;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data } = await supabase.rpc('user_team_ids_in_club', {
    p_club_id: clubId,
  });
  // setof uuid → array de strings.
  return ((data ?? []) as unknown as string[]).filter(Boolean);
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
  // en vez de decidir por memberships.role. Así un principal del EQUIPO con rol
  // de club ayudante (que la rama (B) de la RLS reconoce vía
  // user_is_principal_of_team) NO se queda sin el botón, y un ayudante sin
  // can_manage_calendar tampoco lo ve. Eventos a nivel club (team_id null) solo
  // los gestionan admin/coord, ya cubiertos arriba.
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
