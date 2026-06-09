import {
  TIMEZONE_OLA1,
  createSupabaseServerClient,
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
  season: string;
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
  filters: CalendarFilters
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
    };
  });

  // Teams + categories del club para los selectores de filtro y dialog.
  const { data: rawTeams } = await supabase
    .from('teams')
    .select(
      'id, name, color, season, category_id, categories!inner(name, club_id, half_duration_minutes)',
    )
    .order('name');

  const teams: TeamOption[] = (rawTeams ?? [])
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

  const { data: rawCategories } = await supabase
    .from('categories')
    .select('id, name, season, half_duration_minutes')
    .eq('club_id', clubId)
    .order('season', { ascending: false })
    .order('name');

  const categories: CategoryOption[] = (rawCategories ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    season: c.season as string,
    half_duration_minutes: (c.half_duration_minutes as number | null) ?? 45,
  }));

  return { events, teams, categories };
}

/**
 * Devuelve los teams en los que el user actual puede gestionar eventos.
 * Espejo del helper SQL `user_can_manage_event`:
 *   - admin_club / coordinador → todos los teams del club.
 *   - entrenador_principal → teams donde es staff activo.
 *   - entrenador_ayudante con can_manage_calendar → teams donde es staff.
 *   - jugador → ninguno.
 */
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

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Cuando role es ayudante, además verificamos can_manage_calendar.
  if (role === 'entrenador_ayudante') {
    const { data: caps } = await supabase
      .from('capabilities')
      .select('granted, memberships!inner(profile_id, club_id)')
      .eq('capability_name', 'can_manage_calendar')
      .eq('granted', true);
    type Row = {
      granted: boolean;
      memberships: { profile_id: string; club_id: string };
    };
    const hasCap = (caps ?? []).some((r) => {
      const row = r as unknown as Row;
      return row.memberships.club_id === clubId && row.granted;
    });
    if (!hasCap) {
      return { manageableTeamIds: [], canManageClubEvents: false };
    }
  }

  // Teams donde el user actual es staff activo. Reutiliza user_is_staff_of_team
  // implícito vía RLS sobre team_staff (filtra a su propio profile).
  const { data: { user } = { user: null } } = await supabase.auth.getUser();
  if (!user) return { manageableTeamIds: [], canManageClubEvents: false };

  const { data: rawStaff } = await supabase
    .from('team_staff')
    .select('team_id, memberships!inner(profile_id, club_id)')
    .is('left_at', null);
  type StaffRow = {
    team_id: string;
    memberships: { profile_id: string; club_id: string };
  };
  const manageableTeamIds = (rawStaff ?? [])
    .map((r) => r as unknown as StaffRow)
    .filter(
      (r) => r.memberships.profile_id === user.id && r.memberships.club_id === clubId
    )
    .map((r) => r.team_id);

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
  };
}

/**
 * Helper: convierte un LocalDay al ISO YYYY-MM-DD para URLs.
 */
export function dayToIsoParam(day: LocalDay): string {
  return toIsoDate(day);
}
