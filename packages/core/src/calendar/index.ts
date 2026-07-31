import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { teamsInActiveSeason } from '../schemas/club-structure';
import { getActiveSeasonLabelFromClient } from '../season/active-season';

/**
 * O2-5 B1 — Datos del CALENDARIO (lectura), extraído de
 * `apps/web/.../calendario/queries.ts`. La query toma el rango como ISO (el
 * cálculo del rango de vista sigue en el caller: web con `calendar-utils`, native
 * con su propio rango de agenda). Comportamiento idéntico al histórico.
 */
type DbClient = SupabaseClient<Database>;

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
  team_name: string | null;
  team_color: string | null;
  category_name: string | null;
  has_session: boolean;
  cancelled_at: string | null;
  cancellation_source: 'person' | 'holiday' | null;
  cancellation_reason: string | null;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  rejection_reason: string | null;
};

export type TeamOption = {
  id: string;
  name: string;
  color: string;
  category_id: string;
  category_name: string;
  season: string;
  half_duration_minutes: number;
};

export type CategoryOption = {
  id: string;
  name: string;
  half_duration_minutes: number;
};

export type CalendarFilters = {
  teamIds: string[];
  categoryIds: string[];
  types: string[];
};

export type HolidayInfo = { id: string; date: string; reason: string };

/** Rango UTC de la consulta (calculado por el caller). */
export type CalendarRangeIso = { startIso: string; endIso: string };

/**
 * Equipos del usuario en el club (acota la agenda de jugador/familia). Espeja la
 * rama no-admin de `loadCalendarScopeTeamIds` de web: el rpc `user_team_ids_in_club`
 * EXIGE `p_club_id` (setof uuid) → se pasa el club y se filtran vacíos.
 */
export async function getCalendarScopeTeamIdsFromClient(
  supabase: DbClient,
  clubId: string
): Promise<string[]> {
  const { data } = await supabase.rpc('user_team_ids_in_club', {
    p_club_id: clubId,
  });
  return ((data ?? []) as unknown as string[]).filter(Boolean);
}

/** Festivos del club en un rango de días 'YYYY-MM-DD' (inclusive). */
export async function getHolidaysFromClient(
  supabase: DbClient,
  clubId: string,
  fromDate: string,
  toDate: string
): Promise<HolidayInfo[]> {
  const { data } = await supabase
    .from('holidays')
    .select('id, date, reason')
    .eq('club_id', clubId)
    .gte('date', fromDate)
    .lte('date', toDate);
  return (data ?? []).map((h) => ({
    id: h.id as string,
    date: h.date as string,
    reason: h.reason as string,
  }));
}

async function loadPlannedEventIds(
  supabase: DbClient,
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

export async function getCalendarDataFromClient(
  supabase: DbClient,
  clubId: string,
  range: CalendarRangeIso,
  filters: CalendarFilters,
  opts?: { scopeTeamIds?: string[] | null }
): Promise<{
  events: CalendarEvent[];
  teams: TeamOption[];
  categories: CategoryOption[];
}> {
  let query = supabase
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
    .eq('club_id', clubId)
    .gte('starts_at', range.startIso)
    .lt('starts_at', range.endIso)
    .order('starts_at', { ascending: true });

  // Acota a los equipos del usuario (+ eventos de club, team_id null).
  if (opts?.scopeTeamIds != null) {
    const scope = opts.scopeTeamIds;
    if (scope.length > 0) {
      query = query.or(`team_id.in.(${scope.join(',')}),team_id.is.null`);
    } else {
      query = query.is('team_id', null);
    }
  }
  if (filters.teamIds.length > 0) query = query.in('team_id', filters.teamIds);
  if (filters.categoryIds.length > 0) {
    query = query.in('category_id', filters.categoryIds);
  }
  if (filters.types.length > 0) query = query.in('type', filters.types);

  const { data: rawEvents } = await query;

  type RawTeam = { name: string; color: string; categories: { name: string } | null };
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
      cancelled_at: (e.cancelled_at as string | null) ?? null,
      cancellation_source:
        (e.cancellation_source as CalendarEvent['cancellation_source']) ?? null,
      cancellation_reason: (e.cancellation_reason as string | null) ?? null,
      approval_status:
        (e.approval_status as CalendarEvent['approval_status']) ?? null,
      rejection_reason: (e.rejection_reason as string | null) ?? null,
    };
  });

  const trainingIds = events.filter((e) => e.type === 'training').map((e) => e.id);
  const plannedIds = await loadPlannedEventIds(supabase, trainingIds);
  for (const e of events) if (plannedIds.has(e.id)) e.has_session = true;

  const { data: rawTeams } = await supabase
    .from('teams')
    .select(
      'id, name, color, season, category_id, categories!inner(name, club_id, half_duration_minutes)'
    )
    .order('name');
  const allTeams = (rawTeams ?? [])
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

  const activeSeason = await getActiveSeasonLabelFromClient(supabase, clubId);
  const teams: TeamOption[] = teamsInActiveSeason(allTeams, activeSeason);

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
