/**
 * F12.2 — Queries del editor de sesiones.
 *
 * Lee de `sessions` + `session_blocks` + `session_block_exercises` (F12.1)
 * CONFIANDO en la RLS: no reimplementa permisos. La RLS decide la visibilidad
 * (staff del club ve todo; jugador/familia solo team-visible). Aquí solo se scopea
 * al club activo. Sin paginación: una sesión es un set pequeño.
 */

import {
  type SessionBlockType,
  type SessionVisibility,
  type PlaySignalId,
  addDaysIso,
  createSupabaseServerClient,
  createSupabaseAdminClient,
  getCurrentUser,
  parsePlay,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

// ── Equipos del club (selector de la cabecera) ───────────────────────────────
export type ClubTeam = { id: string; name: string; season: string };

/**
 * Equipos del club destinables a una sesión: SOLO los de la temporada ACTIVA
 * (seasons.status='active', vía getActiveSeasonLabel — Rework C5). Los equipos de
 * temporadas finalizadas son históricos del rollover y no deben aparecer en el
 * selector de "Nueva sesión"/cabecera.
 */
export async function loadClubTeams(clubId: string): Promise<ClubTeam[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const activeSeason = await getActiveSeasonLabel(supabase, clubId);

  const { data } = await supabase
    .from('teams')
    .select('id, name, season')
    .eq('club_id', clubId)
    .eq('season', activeSeason)
    .order('name', { ascending: true });

  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    season: t.season as string,
  }));
}

// ── Listado de sesiones (12.3, patrón F2.10) ─────────────────────────────────
export const SESSIONS_PAGE_SIZE = 20;

export type SessionListRow = {
  id: string;
  title: string | null;
  session_date: string | null;
  team_name: string | null;
  total_minutes: number | null;
};

export type SessionListFilters = {
  search: string;
  teamId: string | null;
  from: string | null;
  to: string | null;
};

export type SessionListResult = { sessions: SessionListRow[]; total: number };

/**
 * Lista las sesiones REALES del club (is_template=false), CONFIANDO en la RLS.
 * Filtros por título (ilike), equipo y rango de fechas; paginación con .range()
 * (patrón F2.10). Orden por fecha descendente.
 */
export async function loadSessions(
  clubId: string,
  filters: SessionListFilters,
  page: number
): Promise<SessionListResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  let q = supabase
    .from('sessions')
    .select('id, title, session_date, total_minutes, team:teams(name)', { count: 'exact' })
    .eq('club_id', clubId)
    .eq('is_template', false);

  if (filters.search.trim().length > 0) {
    const escaped = filters.search.trim().replace(/[%_,]/g, (m) => `\\${m}`);
    q = q.ilike('title', `%${escaped}%`);
  }
  if (filters.teamId) q = q.eq('team_id', filters.teamId);
  if (filters.from) q = q.gte('session_date', filters.from);
  if (filters.to) q = q.lte('session_date', filters.to);

  const from = (page - 1) * SESSIONS_PAGE_SIZE;
  const to = from + SESSIONS_PAGE_SIZE - 1;
  q = q.order('session_date', { ascending: false, nullsFirst: false }).range(from, to);

  const { data, count } = await q;

  const sessions: SessionListRow[] = (data ?? []).map((s) => {
    const team = s.team as { name: string } | null;
    return {
      id: s.id as string,
      title: (s.title as string | null) ?? null,
      session_date: (s.session_date as string | null) ?? null,
      team_name: team?.name ?? null,
      total_minutes: (s.total_minutes as number | null) ?? null,
    };
  });

  return { sessions, total: count ?? 0 };
}

// ── Plantillas del club (12.6 — pestaña "Plantillas", solo staff) ────────────
export type TemplateRow = {
  id: string;
  title: string | null;
  total_minutes: number | null;
  created_at: string;
};

/**
 * Lista las PLANTILLAS del club (is_template=true), CONFIANDO en la RLS: las
 * plantillas solo las ve el staff (jugador/familia nunca — 12.1). Orden por fecha de
 * creación descendente. Sin paginación: el set de plantillas por club es modesto.
 */
export async function loadTemplates(clubId: string): Promise<TemplateRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

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

// ── Vista semana / microciclo (12.3) ─────────────────────────────────────────
export type SessionWeekRow = {
  id: string;
  title: string | null;
  session_date: string;
  total_minutes: number | null;
};

/**
 * Sesiones de UN equipo en la semana [mondayIso, mondayIso+7). RLS = gate. Para la
 * vista microciclo (read-only): la page agrupa por día con weekDaysIso.
 */
export async function loadSessionsWeek(
  clubId: string,
  teamId: string,
  mondayIso: string
): Promise<SessionWeekRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const endIso = addDaysIso(mondayIso, 7); // exclusivo

  const { data } = await supabase
    .from('sessions')
    .select('id, title, session_date, total_minutes')
    .eq('club_id', clubId)
    .eq('is_template', false)
    .eq('team_id', teamId)
    .gte('session_date', mondayIso)
    .lt('session_date', endIso)
    .order('session_date', { ascending: true });

  return (data ?? [])
    .filter((s) => s.session_date != null)
    .map((s) => ({
      id: s.id as string,
      title: (s.title as string | null) ?? null,
      session_date: s.session_date as string,
      total_minutes: (s.total_minutes as number | null) ?? null,
    }));
}

// ── Sesiones publicadas del equipo (12.4 — vista jugador/familia) ────────────
export type PublishedSessionRow = {
  id: string;
  title: string | null;
  session_date: string;
  total_minutes: number | null;
};

/**
 * Sesiones PUBLICADAS (visibility='team') de UN equipo a partir de `fromIso`
 * (próximas, incluido hoy), ordenadas por fecha ascendente. La RLS de 12.1
 * (user_is_team_member_account) es el gate real: solo devuelve filas que el
 * jugador/familia puede ver; los filtros explícitos refuerzan la intención.
 */
export async function loadPublishedSessionsForTeam(
  clubId: string,
  teamId: string,
  fromIso: string,
  limit = 10
): Promise<PublishedSessionRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('sessions')
    .select('id, title, session_date, total_minutes')
    .eq('club_id', clubId)
    .eq('team_id', teamId)
    .eq('is_template', false)
    .eq('visibility', 'team')
    .gte('session_date', fromIso)
    .order('session_date', { ascending: true })
    .limit(limit);

  return (data ?? [])
    .filter((s) => s.session_date != null)
    .map((s) => ({
      id: s.id as string,
      title: (s.title as string | null) ?? null,
      session_date: s.session_date as string,
      total_minutes: (s.total_minutes as number | null) ?? null,
    }));
}

// ── Sesión para editar (cabecera + bloques + tareas) ─────────────────────────
export type SessionTaskForEdit = {
  id: string;
  exercise_id: string;
  exercise_name: string;
  order_idx: number;
  duration_min: number | null;
  series: string | null;
  notes: string | null;
};

// JS-1 — jugada del playbook añadida a un bloque (override del día: duración/notas).
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
  /** `kind` de la categoría del equipo (CATEGORY_KIND), default del filtro del picker. */
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
  /** 'staff' = borrador; 'team' = publicada al equipo (12.4). */
  visibility: SessionVisibility;
  is_owner: boolean;
  blocks: SessionBlockForEdit[];
};

/**
 * Carga UNA sesión por id con sus bloques y tareas, CONFIANDO en la RLS: si el
 * user no puede verla, no hay fila → null (la page hace notFound). Se scopea al
 * club activo (un id de otro club → null). Bloques y tareas vienen ordenados por
 * `order_idx`; las tareas resuelven el nombre del ejercicio.
 */
export async function loadSessionForEdit(
  clubId: string,
  id: string
): Promise<SessionForEdit | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  const { data } = await supabase
    .from('sessions')
    .select(
      `id, team_id, session_date, title, objective_physical,
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
       )`
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

// ── Meta de ejercicios de una sesión visible (12.4 — vista jugador/familia) ──
export type SessionExerciseMeta = {
  exercise_id: string;
  name: string;
  tactical_objectives: string[];
  technical_objectives: string[];
};

/**
 * Nombre + objetivos de los ejercicios referenciados por una sesión que el user
 * PUEDE ver. Vía el RPC SECURITY DEFINER `session_exercise_meta` (12.4): el
 * jugador/familia no puede leer `exercises` (RLS staff), así que el embed normal no
 * resuelve el nombre. El RPC expone SOLO nombre/objetivos y solo de los ejercicios
 * de esa sesión, gateado por user_can_see_session. Devuelve un mapa por exercise_id.
 */
export async function loadSessionExerciseMeta(
  sessionId: string
): Promise<Map<string, SessionExerciseMeta>> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

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

// ── Sesión para PDF (12.5 — hoja de sesión, staff) ───────────────────────────
// El PDF (D6) replica el anexo: cabecera + bloques + tareas con TODOS los campos
// de la tarea del anexo, que el modelo `exercises` (F11.1) ya cubre (description,
// objective, coaching_points, variants, players, space_*, base_duration). El staff
// SÍ puede leer `exercises` (RLS), así que aquí se embebe directo (sin el RPC de
// 12.4, que es para jugador/familia).
export type SessionPdfTask = {
  exercise_name: string;
  duration_min: number | null;
  series: string | null;
  notes: string | null; // override del día
  description: string | null;
  objective: string | null;
  coaching_points: string | null;
  variants: string | null;
  players: string | null;
  space_type: string | null;
  space_dimensions: string | null;
  base_duration: number | null;
  tactical_objectives: string[];
  technical_objectives: string[];
};

// JS-2 — jugada del bloque en el PDF (D5 mínimo: nombre + nº frames + override del día).
// TANDA 2 — + seña del equipo de la sesión (team_plays.signal_id; null si sin asignar).
export type SessionPdfPlay = {
  play_name: string;
  frame_count: number;
  duration_min: number | null;
  notes: string | null;
  signal_id: PlaySignalId | null;
};

export type SessionPdfBlock = {
  block_type: SessionBlockType;
  title: string | null;
  notes: string | null;
  total_minutes: number | null; // suma de tareas (override o base) + jugadas (duration_min)
  tasks: SessionPdfTask[];
  plays: SessionPdfPlay[];
};

export type SessionForPdf = {
  team_name: string | null;
  category_name: string | null;
  season: string | null;
  session_date: string | null;
  title: string | null;
  objective_physical: string | null;
  tactical_objectives: string[];
  technical_objectives: string[];
  total_minutes: number | null;
  mesocycle: string | null;
  microcycle: string | null;
  blocks: SessionPdfBlock[];
};

export async function loadSessionForPdf(
  clubId: string,
  id: string
): Promise<SessionForPdf | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('sessions')
    .select(
      `id, team_id, session_date, title, objective_physical,
       tactical_objectives, technical_objectives, mesocycle, microcycle,
       total_minutes,
       team:teams ( name, season, category:categories ( name ) ),
       session_blocks (
         block_type, title, notes, order_idx,
         session_block_exercises (
           order_idx, duration_min, series, notes,
           exercise:exercises (
             name, description, objective, coaching_points, variants, players,
             space_type, space_dimensions, base_duration,
             tactical_objectives, technical_objectives
           )
         ),
         session_block_plays (
           order_idx, duration_min, notes,
           play:plays ( id, name, play )
         )
       )`
    )
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data) return null;

  const team = data.team as
    | { name: string | null; season: string | null; category: { name: string | null } | null }
    | null;

  type RawTask = {
    order_idx: number;
    duration_min: number | null;
    series: string | null;
    notes: string | null;
    exercise: {
      name: string | null;
      description: string | null;
      objective: string | null;
      coaching_points: string | null;
      variants: string | null;
      players: string | null;
      space_type: string | null;
      space_dimensions: string | null;
      base_duration: number | null;
      tactical_objectives: string[] | null;
      technical_objectives: string[] | null;
    } | null;
  };
  type RawPdfPlay = {
    order_idx: number;
    duration_min: number | null;
    notes: string | null;
    play: { id: string; name: string | null; play: unknown } | null;
  };
  type RawBlock = {
    block_type: string;
    title: string | null;
    notes: string | null;
    order_idx: number;
    session_block_exercises: RawTask[] | null;
    session_block_plays: RawPdfPlay[] | null;
  };

  // Seña POR EQUIPO (TANDA 2): la sesión tiene team_id → buscamos en team_plays la
  // seña que ESE equipo usa para cada jugada de la sesión. Usamos admin client (read
  // acotado a team_id + play_ids) porque la RLS de team_plays exige ser staff DEL
  // equipo y quien genera el PDF puede ser admin/coord que no lo es → así el
  // pictograma sale siempre que exista. Si una jugada no tiene seña para el equipo,
  // queda null (se omite el pictograma). La sesión ya está autorizada arriba.
  const rawBlocks = (data.session_blocks as RawBlock[] | null) ?? [];
  const sessionTeamId = (data.team_id as string | null) ?? null;
  const playIds = Array.from(
    new Set(
      rawBlocks.flatMap((b) =>
        (b.session_block_plays ?? []).map((p) => p.play?.id).filter((x): x is string => !!x),
      ),
    ),
  );
  const signalByPlayId = new Map<string, PlaySignalId | null>();
  if (sessionTeamId && playIds.length > 0) {
    const admin = createSupabaseAdminClient();
    const { data: tps } = await admin
      .from('team_plays')
      .select('play_id, signal_id')
      .eq('team_id', sessionTeamId)
      .in('play_id', playIds);
    for (const tp of tps ?? []) {
      signalByPlayId.set(
        tp.play_id as string,
        (tp.signal_id as PlaySignalId | null) ?? null,
      );
    }
  }

  const blocks: SessionPdfBlock[] = rawBlocks
    .slice()
    .sort((a, b2) => a.order_idx - b2.order_idx)
    .map((b) => {
      const tasks: SessionPdfTask[] = (b.session_block_exercises ?? [])
        .slice()
        .sort((a, b2) => a.order_idx - b2.order_idx)
        .map((tk) => ({
          exercise_name: tk.exercise?.name ?? '',
          duration_min: tk.duration_min,
          series: tk.series,
          notes: tk.notes,
          description: tk.exercise?.description ?? null,
          objective: tk.exercise?.objective ?? null,
          coaching_points: tk.exercise?.coaching_points ?? null,
          variants: tk.exercise?.variants ?? null,
          players: tk.exercise?.players ?? null,
          space_type: tk.exercise?.space_type ?? null,
          space_dimensions: tk.exercise?.space_dimensions ?? null,
          base_duration: tk.exercise?.base_duration ?? null,
          tactical_objectives: tk.exercise?.tactical_objectives ?? [],
          technical_objectives: tk.exercise?.technical_objectives ?? [],
        }));
      const plays: SessionPdfPlay[] = (b.session_block_plays ?? [])
        .slice()
        .sort((a, b2) => a.order_idx - b2.order_idx)
        .map((p) => {
          const parsed = parsePlay(p.play?.play);
          return {
            play_name: p.play?.name ?? '',
            frame_count: parsed.success ? parsed.data.frames.length : 0,
            duration_min: p.duration_min,
            notes: p.notes,
            signal_id: p.play?.id ? (signalByPlayId.get(p.play.id) ?? null) : null,
          };
        });
      // Tiempo del bloque = duración del día (o base) de las tareas + duración de las
      // jugadas (D8: lo mismo que persiste la BD en total_minutes de la sesión).
      const mins = [
        ...tasks.map((tk) => tk.duration_min ?? tk.base_duration),
        ...plays.map((p) => p.duration_min),
      ].filter((n): n is number => typeof n === 'number');
      return {
        block_type: b.block_type as SessionBlockType,
        title: b.title,
        notes: b.notes,
        total_minutes: mins.length > 0 ? mins.reduce((s, n) => s + n, 0) : null,
        tasks,
        plays,
      };
    });

  return {
    team_name: team?.name ?? null,
    category_name: team?.category?.name ?? null,
    season: team?.season ?? null,
    session_date: (data.session_date as string | null) ?? null,
    title: (data.title as string | null) ?? null,
    objective_physical: (data.objective_physical as string | null) ?? null,
    tactical_objectives: (data.tactical_objectives as string[] | null) ?? [],
    technical_objectives: (data.technical_objectives as string[] | null) ?? [],
    total_minutes: (data.total_minutes as number | null) ?? null,
    mesocycle: (data.mesocycle as string | null) ?? null,
    microcycle: (data.microcycle as string | null) ?? null,
    blocks,
  };
}

// ── Ejercicios elegibles para el picker (12.2b) ──────────────────────────────
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
 * sus taxonomías para FILTRAR en cliente (categoría del equipo + objetivos — D8).
 * Sin paginación: el set por club es modesto (como loadBoardExercises de 11B.1).
 */
export async function loadPickableExercises(clubId: string): Promise<PickableExercise[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

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

// ── Jugadas elegibles para el picker de la sesión (JS-1) ──────────────────────
export type AddableSessionPlay = {
  id: string;
  name: string | null;
  frame_count: number;
  updated_at: string;
};

/** Tope de resultados del picker de jugadas (el playbook por equipo es modesto). */
export const ADDABLE_SESSION_PLAYS_LIMIT = 50;

/**
 * JS-1 — Jugadas del PLAYBOOK del equipo de la sesión (team_plays ⋈ plays de
 * `teamId`), candidatas a añadir a un bloque. TODAS las seleccionadas, sin importar
 * `shared_with_family` (entrenar ≠ compartir). Búsqueda por nombre; se excluyen las
 * de `excludeIds` (las ya añadidas a la sesión/bloque). La RLS de team_plays/plays
 * es el gate. Limitado a ADDABLE_SESSION_PLAYS_LIMIT (con búsqueda basta). Si la
 * sesión no tiene equipo (plantilla), no hay playbook → [] (D4).
 */
export async function loadAddablePlaysForSession(
  clubId: string,
  teamId: string | null,
  search: string,
  excludeIds: string[] = []
): Promise<AddableSessionPlay[]> {
  if (!teamId) return [];

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('team_plays')
    .select('play:plays!inner(id, name, play, updated_at, club_id, status, archived_at)')
    .eq('team_id', teamId);

  const exclude = new Set(excludeIds);
  const needle = search.trim().toLowerCase();

  const rows = (data ?? [])
    .map((tp) => {
      const p = tp.play as unknown as
        | { id: string; name: string | null; play: unknown; updated_at: string; club_id: string; status: string; archived_at: string | null }
        | null;
      if (!p) return null;
      // Defensa en profundidad: solo del club activo (la RLS ya lo asegura).
      if (p.club_id !== clubId) return null;
      if (exclude.has(p.id)) return null;
      if (needle && !(p.name ?? '').toLowerCase().includes(needle)) return null;
      const parsed = parsePlay(p.play);
      return {
        id: p.id,
        name: p.name ?? null,
        frame_count: parsed.success ? parsed.data.frames.length : 0,
        updated_at: p.updated_at,
      } satisfies AddableSessionPlay;
    })
    .filter((r): r is AddableSessionPlay => r != null);

  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return rows.slice(0, ADDABLE_SESSION_PLAYS_LIMIT);
}
