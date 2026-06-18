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
  createSupabaseServerClient,
  getCurrentUser,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ── Equipos del club (selector de la cabecera) ───────────────────────────────
export type ClubTeam = { id: string; name: string; season: string };

/** Equipos del club activo (id, name, season) para el selector de equipo destino. */
export async function loadClubTeams(clubId: string): Promise<ClubTeam[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('teams')
    .select('id, name, season')
    .eq('club_id', clubId)
    .order('season', { ascending: false })
    .order('name', { ascending: true });

  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    season: t.season as string,
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

export type SessionBlockForEdit = {
  id: string;
  block_type: SessionBlockType;
  title: string | null;
  notes: string | null;
  order_idx: number;
  tasks: SessionTaskForEdit[];
};

export type SessionForEdit = {
  id: string;
  team_id: string | null;
  session_date: string | null;
  title: string | null;
  objective_physical: string | null;
  tactical_objectives: string[];
  technical_objectives: string[];
  mesocycle: string | null;
  microcycle: string | null;
  total_minutes: number | null;
  is_template: boolean;
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
       total_minutes, is_template, owner_profile_id,
       session_blocks (
         id, block_type, title, notes, order_idx,
         session_block_exercises (
           id, exercise_id, order_idx, duration_min, series, notes,
           exercise:exercises ( name )
         )
       )`
    )
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data) return null;

  type RawTask = {
    id: string;
    exercise_id: string;
    order_idx: number;
    duration_min: number | null;
    series: string | null;
    notes: string | null;
    exercise: { name: string } | null;
  };
  type RawBlock = {
    id: string;
    block_type: string;
    title: string | null;
    notes: string | null;
    order_idx: number;
    session_block_exercises: RawTask[] | null;
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
    }))
    .sort((a, b2) => a.order_idx - b2.order_idx);

  return {
    id: data.id as string,
    team_id: (data.team_id as string | null) ?? null,
    session_date: (data.session_date as string | null) ?? null,
    title: (data.title as string | null) ?? null,
    objective_physical: (data.objective_physical as string | null) ?? null,
    tactical_objectives: (data.tactical_objectives as string[] | null) ?? [],
    technical_objectives: (data.technical_objectives as string[] | null) ?? [],
    mesocycle: (data.mesocycle as string | null) ?? null,
    microcycle: (data.microcycle as string | null) ?? null,
    total_minutes: (data.total_minutes as number | null) ?? null,
    is_template: (data.is_template as boolean | null) ?? false,
    is_owner: user != null && data.owner_profile_id === user.id,
    blocks,
  };
}
