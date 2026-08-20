import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';
import { parsePlay } from '../diagram/play';
import type { SessionBlockType, SessionVisibility } from './sessions';

/**
 * O2-5 D1 — FETCH de sesiones para la vista de LECTURA (jugador/familia), extraído
 * de apps/web/.../sesiones/queries.ts. Solo el fetch se extrae; las firmas web
 * pasan a wrappers. La RLS (12.1 user_can_see_session / user_is_team_member_account)
 * es el gate; los filtros explícitos refuerzan la intención. `getSessionForEdit`
 * lo comparte el editor staff (sin cambio de comportamiento).
 */
type DbClient = SupabaseClient<Database>;

// ── Sesiones compartidas (visibility='team') de VARIOS equipos ─────────────────

export type PlayerSharedSessionRow = {
  id: string;
  title: string | null;
  session_date: string;
  total_minutes: number | null;
  team_id: string;
  team_name: string;
};

export async function getSharedSessionsForTeamsFromClient(
  supabase: DbClient,
  clubId: string,
  teams: ReadonlyArray<{ id: string; name: string }>,
  fromIso: string,
  limit = 50,
): Promise<PlayerSharedSessionRow[]> {
  if (teams.length === 0) return [];
  const teamIds = teams.map((t) => t.id);
  const nameById = new Map(teams.map((t) => [t.id, t.name]));

  const { data } = await supabase
    .from('sessions')
    .select('id, title, session_date, total_minutes, team_id')
    .eq('club_id', clubId)
    .in('team_id', teamIds)
    .eq('is_template', false)
    .eq('visibility', 'team')
    .gte('session_date', fromIso)
    .order('session_date', { ascending: true })
    .limit(limit);

  return (data ?? [])
    .filter((s) => s.session_date != null && s.team_id != null)
    .map((s) => ({
      id: s.id as string,
      title: (s.title as string | null) ?? null,
      session_date: s.session_date as string,
      total_minutes: (s.total_minutes as number | null) ?? null,
      team_id: s.team_id as string,
      team_name: nameById.get(s.team_id as string) ?? '',
    }));
}

// ── Entrenamientos del equipo (TODOS) + si tienen sesión compartida ────────────

export type TeamTrainingRow = {
  event_id: string;
  team_id: string;
  team_name: string;
  title: string | null;
  starts_at: string;
  location_name: string | null;
  /** Id de la sesión compartida (visibility='team') ligada al entrenamiento, o null. */
  session_id: string | null;
};

/**
 * O2 — Lista TODOS los entrenamientos (type='training') del/los equipo(s) desde
 * `fromIso`, y marca cuáles tienen SESIÓN COMPARTIDA. El criterio de "tiene sesión"
 * espeja el `has_session` de la web (calendar `loadPlannedEventIds`: existe fila en
 * `sessions` con ese `event_id` e `is_template=false`), añadiendo `visibility='team'`
 * porque la familia solo ve las compartidas (igual que getSharedSessionsForTeams).
 * Devuelve además el `session_id` para abrir el detalle reutilizando `sesion-detalle`.
 * RLS es el gate; los filtros refuerzan la intención.
 */
export async function getTeamTrainingsFromClient(
  supabase: DbClient,
  clubId: string,
  teams: ReadonlyArray<{ id: string; name: string }>,
  fromIso: string,
  limit = 100,
): Promise<TeamTrainingRow[]> {
  if (teams.length === 0) return [];
  const teamIds = teams.map((t) => t.id);
  const nameById = new Map(teams.map((t) => [t.id, t.name]));

  const { data: evs } = await supabase
    .from('events')
    .select('id, team_id, title, starts_at, location_name')
    .eq('club_id', clubId)
    .in('team_id', teamIds)
    .eq('type', 'training')
    .gte('starts_at', fromIso)
    .order('starts_at', { ascending: true })
    .limit(limit);

  const events = (evs ?? []).filter((e) => e.starts_at != null && e.team_id != null);
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id as string);
  const { data: sess } = await supabase
    .from('sessions')
    .select('id, event_id')
    .in('event_id', eventIds)
    .eq('is_template', false)
    .eq('visibility', 'team');

  const sessionByEvent = new Map<string, string>();
  for (const s of sess ?? []) {
    const ev = s.event_id as string | null;
    if (ev && !sessionByEvent.has(ev)) sessionByEvent.set(ev, s.id as string);
  }

  return events.map((e) => ({
    event_id: e.id as string,
    team_id: e.team_id as string,
    team_name: nameById.get(e.team_id as string) ?? '',
    title: (e.title as string | null) ?? null,
    starts_at: e.starts_at as string,
    location_name: (e.location_name as string | null) ?? null,
    session_id: sessionByEvent.get(e.id as string) ?? null,
  }));
}

// ── Una sesión con bloques/tareas/jugadas (editor staff + lectura jugador) ──────

export type SessionTaskForEdit = {
  id: string;
  exercise_id: string;
  exercise_name: string;
  order_idx: number;
  duration_min: number | null;
  series: string | null;
  notes: string | null;
};

export type SessionBlockPlayForEdit = {
  id: string;
  play_id: string;
  play_name: string;
  frame_count: number;
  order_idx: number;
  duration_min: number | null;
  notes: string | null;
};

export type SessionBlockForEdit = {
  id: string;
  block_type: SessionBlockType;
  title: string | null;
  notes: string | null;
  order_idx: number;
  tasks: SessionTaskForEdit[];
  plays: SessionBlockPlayForEdit[];
};

export type SessionForEdit = {
  id: string;
  team_id: string | null;
  /** Entrenamiento al que está asignada la sesión (events.id) o null si es suelta. */
  event_id: string | null;
  team_category_kind: string | null;
  session_date: string | null;
  title: string | null;
  objective_physical: string | null;
  tactical_objectives: string[];
  technical_objectives: string[];
  mesocycle: string | null;
  microcycle: string | null;
  total_minutes: number | null;
  is_template: boolean;
  visibility: SessionVisibility;
  is_owner: boolean;
  blocks: SessionBlockForEdit[];
};

export async function getSessionForEditFromClient(
  supabase: DbClient,
  clubId: string,
  id: string,
): Promise<SessionForEdit | null> {
  const user = await getCurrentUserFromClient(supabase);

  const { data } = await supabase
    .from('sessions')
    .select(
      `id, team_id, event_id, session_date, title, objective_physical,
       tactical_objectives, technical_objectives, mesocycle, microcycle,
       total_minutes, is_template, visibility, owner_profile_id,
       team:teams ( category:categories ( kind ) ),
       session_blocks (
         id, block_type, title, notes, order_idx,
         session_block_exercises (
           id, exercise_id, order_idx, duration_min, series, notes,
           exercise:exercises ( name )
         ),
         session_block_plays (
           id, play_id, order_idx, duration_min, notes,
           play:plays ( name, play )
         )
       )`,
    )
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data) return null;

  const team = data.team as { category: { kind: string | null } | null } | null;

  type RawTask = {
    id: string;
    exercise_id: string;
    order_idx: number;
    duration_min: number | null;
    series: string | null;
    notes: string | null;
    exercise: { name: string } | null;
  };
  type RawBlockPlay = {
    id: string;
    play_id: string;
    order_idx: number;
    duration_min: number | null;
    notes: string | null;
    play: { name: string | null; play: unknown } | null;
  };
  type RawBlock = {
    id: string;
    block_type: string;
    title: string | null;
    notes: string | null;
    order_idx: number;
    session_block_exercises: RawTask[] | null;
    session_block_plays: RawBlockPlay[] | null;
  };

  const blocks: SessionBlockForEdit[] = ((data.session_blocks as RawBlock[] | null) ?? [])
    .map((b) => ({
      id: b.id,
      block_type: b.block_type as SessionBlockType,
      title: b.title,
      notes: b.notes,
      order_idx: b.order_idx,
      tasks: (b.session_block_exercises ?? [])
        .map((t) => ({
          id: t.id,
          exercise_id: t.exercise_id,
          exercise_name: t.exercise?.name ?? '',
          order_idx: t.order_idx,
          duration_min: t.duration_min,
          series: t.series,
          notes: t.notes,
        }))
        .sort((a, b2) => a.order_idx - b2.order_idx),
      plays: (b.session_block_plays ?? [])
        .map((p) => {
          const parsed = parsePlay(p.play?.play);
          return {
            id: p.id,
            play_id: p.play_id,
            play_name: p.play?.name ?? '',
            frame_count: parsed.success ? parsed.data.frames.length : 0,
            order_idx: p.order_idx,
            duration_min: p.duration_min,
            notes: p.notes,
          };
        })
        .sort((a, b2) => a.order_idx - b2.order_idx),
    }))
    .sort((a, b2) => a.order_idx - b2.order_idx);

  return {
    id: data.id as string,
    team_id: (data.team_id as string | null) ?? null,
    event_id: (data.event_id as string | null) ?? null,
    team_category_kind: team?.category?.kind ?? null,
    session_date: (data.session_date as string | null) ?? null,
    title: (data.title as string | null) ?? null,
    objective_physical: (data.objective_physical as string | null) ?? null,
    tactical_objectives: (data.tactical_objectives as string[] | null) ?? [],
    technical_objectives: (data.technical_objectives as string[] | null) ?? [],
    mesocycle: (data.mesocycle as string | null) ?? null,
    microcycle: (data.microcycle as string | null) ?? null,
    total_minutes: (data.total_minutes as number | null) ?? null,
    is_template: (data.is_template as boolean | null) ?? false,
    visibility: ((data.visibility as string | null) ?? 'staff') as SessionVisibility,
    is_owner: user != null && data.owner_profile_id === user.id,
    blocks,
  };
}

// ── Plantillas / plan de sesión desde el evento (G1 — extraído de web) ─────────

/** Plantilla de sesión del club (is_template=true) para el selector "desde plantilla". */
export type SessionTemplateRow = {
  id: string;
  title: string | null;
  total_minutes: number | null;
  created_at: string;
};

/**
 * Plantillas del club (is_template=true), recientes primero. La RLS restringe a
 * staff (jugador/familia nunca ven plantillas). Extraído de `web loadTemplates`.
 */
export async function getSessionTemplatesFromClient(
  supabase: DbClient,
  clubId: string,
): Promise<SessionTemplateRow[]> {
  const { data } = await supabase
    .from('sessions')
    .select('id, title, total_minutes, created_at')
    .eq('club_id', clubId)
    .eq('is_template', true)
    .order('created_at', { ascending: false });
  return (data ?? []).map((s) => ({
    id: s.id as string,
    title: (s.title as string | null) ?? null,
    total_minutes: (s.total_minutes as number | null) ?? null,
    created_at: s.created_at as string,
  }));
}

// ── Ejercicios elegibles para el picker (12.2b — extraído de web) ─────────────
/** Ejercicio del catálogo del club con sus taxonomías para FILTRAR/recomendar en
 *  cliente (categoría + objetivos + fases). Superconjunto de `RecommendableExercise`. */
export type PickableExercise = {
  id: string;
  name: string;
  categories: string[];
  tactical_objectives: string[];
  technical_objectives: string[];
  /** Fases (tipos de bloque) para las que sirve el ejercicio (12.7a). */
  phases: string[];
};

/**
 * Ejercicios del club que el usuario puede ver (la RLS decide), no archivados, con
 * sus taxonomías para filtrar/recomendar en cliente (categoría del equipo +
 * objetivos + fase del bloque — D8/12.7a). Sin paginación: el set por club es
 * modesto. Extraído de `web loadPickableExercises`.
 */
export async function getPickableExercisesFromClient(
  supabase: DbClient,
  clubId: string,
): Promise<PickableExercise[]> {
  const { data } = await supabase
    .from('exercises')
    .select('id, name, categories, tactical_objectives, technical_objectives, phases')
    .eq('club_id', clubId)
    .is('archived_at', null)
    .order('name', { ascending: true });

  return (data ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    categories: (e.categories as string[] | null) ?? [],
    tactical_objectives: (e.tactical_objectives as string[] | null) ?? [],
    technical_objectives: (e.technical_objectives as string[] | null) ?? [],
    phases: (e.phases as string[] | null) ?? [],
  }));
}

/** Id de la sesión (no plantilla) vinculada a un entrenamiento, o null si no tiene. */
export async function getEventSessionIdFromClient(
  supabase: DbClient,
  eventId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('sessions')
    .select('id')
    .eq('event_id', eventId)
    .eq('is_template', false)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Sesión suelta candidata a vincular (del mismo equipo, sin evento). */
export type LinkableSession = {
  id: string;
  title: string | null;
  session_date: string | null;
};

export type PlanSessionOptions =
  | { ok: false; error: 'invalid' }
  | { ok: true; linkedSessionId: string | null; candidates: LinkableSession[] };

/**
 * Opciones del flujo "Planificar sesión" de un entrenamiento (extraído de la web,
 * comportamiento idéntico): si el evento ya tiene sesión vinculada → su id; si no,
 * las sesiones SUELTAS (event_id null, no plantilla) del MISMO equipo, candidatas a
 * vincular. El evento debe ser un training de equipo del club. La AUTORIZACIÓN
 * (ctx/forbidden) la resuelve el caller; aquí solo se valida el evento y la RLS filtra.
 */
export async function getPlanSessionOptionsFromClient(
  supabase: DbClient,
  clubId: string,
  eventId: string,
): Promise<PlanSessionOptions> {
  const { data: ev } = await supabase
    .from('events')
    .select('team_id, type, club_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev || ev.club_id !== clubId || ev.type !== 'training') return { ok: false, error: 'invalid' };
  const teamId = (ev.team_id as string | null) ?? null;
  if (!teamId) return { ok: false, error: 'invalid' };

  const { data: linked } = await supabase
    .from('sessions')
    .select('id')
    .eq('event_id', eventId)
    .eq('is_template', false)
    .maybeSingle();
  if (linked?.id) return { ok: true, linkedSessionId: linked.id as string, candidates: [] };

  const { data: rows } = await supabase
    .from('sessions')
    .select('id, title, session_date')
    .eq('club_id', clubId)
    .eq('team_id', teamId)
    .eq('is_template', false)
    .is('event_id', null)
    .order('session_date', { ascending: false, nullsFirst: false })
    .limit(100);

  const candidates: LinkableSession[] = (rows ?? []).map((s) => ({
    id: s.id as string,
    title: (s.title as string | null) ?? null,
    session_date: (s.session_date as string | null) ?? null,
  }));
  return { ok: true, linkedSessionId: null, candidates };
}

// ── Meta de ejercicios de una sesión visible (RPC SECURITY DEFINER) ────────────

export type SessionExerciseMeta = {
  exercise_id: string;
  name: string;
  tactical_objectives: string[];
  technical_objectives: string[];
};

export async function getSessionExerciseMetaFromClient(
  supabase: DbClient,
  sessionId: string,
): Promise<Map<string, SessionExerciseMeta>> {
  const { data } = await supabase.rpc('session_exercise_meta', {
    p_session_id: sessionId,
  });

  const map = new Map<string, SessionExerciseMeta>();
  for (const r of data ?? []) {
    map.set(r.exercise_id as string, {
      exercise_id: r.exercise_id as string,
      name: (r.name as string | null) ?? '',
      tactical_objectives: (r.tactical_objectives as string[] | null) ?? [],
      technical_objectives: (r.technical_objectives as string[] | null) ?? [],
    });
  }
  return map;
}
