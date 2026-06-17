/**
 * F11.3 — Queries del listado de la biblioteca de ejercicios.
 *
 * Lee de `exercises` (F11.1) CONFIANDO en la RLS: no reimplementa permisos en la
 * query. La RLS ya decide la visibilidad por estado/rol (publicados del club →
 * todo el staff; borradores → su autor; propuestos/rechazados → autor + Admin).
 * Aquí solo se SCOPEA al club activo (`.eq('club_id', clubId)`) y se ocultan los
 * archivados (los publicados que se "borraron" pasan a archived_at). Filtros y
 * paginación replican el patrón de F2.10 (jugadores): searchParams → query con
 * `.range()`.
 *
 * Los vocabularios de los filtros salen de las CONSTANTES de @misterfc/core (no
 * se derivan de los datos): el set de objetivos/categorías/intensidad/espacio es
 * fijo. Sin modelo nuevo.
 */

import {
  EXERCISE_INTENSITIES,
  EXERCISE_SPACE_TYPES,
  type ExerciseIntensity,
  type ExerciseSpaceType,
  type MethodologyStatus,
  type Diagram,
  parseDiagram,
  createSupabaseServerClient,
  getCurrentUser,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export const EXERCISES_PAGE_SIZE = 24;

export type ExerciseRow = {
  id: string;
  name: string;
  status: MethodologyStatus;
  categories: string[];
  tactical_objectives: string[];
  technical_objectives: string[];
  intensity: ExerciseIntensity | null;
  space_type: ExerciseSpaceType | null;
  base_duration: number | null;
  /** Para resaltar "los tuyos" en la UI sin reimplementar permisos. */
  is_owner: boolean;
};

export type ExerciseListFilters = {
  search: string;
  tactical: string[];
  technical: string[];
  categories: string[];
  intensity: string[];
  spaceType: string[];
};

export type ExerciseListResult = {
  exercises: ExerciseRow[];
  total: number;
};

export async function loadExercises(
  clubId: string,
  filters: ExerciseListFilters,
  page: number,
  /** Cola de revisión (11.7): solo propuestos. La RLS ya restringe a Admin/autor
   *  ver propuestos; para la cola del Admin la page solo activa esto si es Admin. */
  proposedOnly = false
): Promise<ExerciseListResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  // Saneo de los multi-valor contra los vocabularios fijos (intensidad/espacio).
  const intensity = filters.intensity.filter((v) =>
    (EXERCISE_INTENSITIES as readonly string[]).includes(v)
  );
  const spaceType = filters.spaceType.filter((v) =>
    (EXERCISE_SPACE_TYPES as readonly string[]).includes(v)
  );

  let q = supabase
    .from('exercises')
    .select(
      `id, name, status, categories, tactical_objectives, technical_objectives,
       intensity, space_type, base_duration, owner_profile_id`,
      { count: 'exact' }
    )
    .eq('club_id', clubId)
    .is('archived_at', null);

  if (proposedOnly) q = q.eq('status', 'proposed');

  if (filters.search.trim().length > 0) {
    const escaped = filters.search.trim().replace(/[%_,]/g, (m) => `\\${m}`);
    q = q.ilike('name', `%${escaped}%`);
  }

  // Multi-select de taxonomías = solape (`&&`): el ejercicio coincide si tiene
  // ALGUNO de los valores marcados.
  if (filters.tactical.length > 0) q = q.overlaps('tactical_objectives', filters.tactical);
  if (filters.technical.length > 0) q = q.overlaps('technical_objectives', filters.technical);
  if (filters.categories.length > 0) q = q.overlaps('categories', filters.categories);

  if (intensity.length > 0) q = q.in('intensity', intensity);
  if (spaceType.length > 0) q = q.in('space_type', spaceType);

  const from = (page - 1) * EXERCISES_PAGE_SIZE;
  const to = from + EXERCISES_PAGE_SIZE - 1;

  q = q.order('name', { ascending: true }).range(from, to);

  const { data, count } = await q;

  const exercises: ExerciseRow[] = (data ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    status: e.status as MethodologyStatus,
    categories: (e.categories as string[] | null) ?? [],
    tactical_objectives: (e.tactical_objectives as string[] | null) ?? [],
    technical_objectives: (e.technical_objectives as string[] | null) ?? [],
    intensity: (e.intensity as ExerciseIntensity | null) ?? null,
    space_type: (e.space_type as ExerciseSpaceType | null) ?? null,
    base_duration: (e.base_duration as number | null) ?? null,
    is_owner: user != null && e.owner_profile_id === user.id,
  }));

  return { exercises, total: count ?? 0 };
}

// ── Ficha (11.4) ─────────────────────────────────────────────────────────────

export type ExerciseDetail = {
  id: string;
  name: string;
  status: MethodologyStatus;
  categories: string[];
  tactical_objectives: string[];
  technical_objectives: string[];
  physical_focus: string | null;
  intensity: ExerciseIntensity | null;
  space_type: ExerciseSpaceType | null;
  space_dimensions: string | null;
  base_duration: number | null;
  description: string | null;
  objective: string | null;
  coaching_points: string | null;
  variants: string | null;
  players: string | null;
  /** Escena validada (parseDiagram). null si no hay o no es válida → se omite. */
  diagram: Diagram | null;
  approved_at: string | null;
  approved_by_name: string | null;
  rejection_reason: string | null;
  created_at: string;
  is_owner: boolean;
};

/**
 * Carga UN ejercicio por id, CONFIANDO en la RLS: si el user no puede verlo, la
 * RLS no devuelve fila → null (la page hace notFound). No reimplementa permisos.
 * Se scopea al club activo por seguridad de contexto (un id de otro club → null).
 */
export async function loadExercise(
  clubId: string,
  id: string
): Promise<ExerciseDetail | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  const { data } = await supabase
    .from('exercises')
    .select(
      `id, name, status, categories, tactical_objectives, technical_objectives,
       physical_focus, intensity, space_type, space_dimensions, base_duration,
       description, objective, coaching_points, variants, players, diagram,
       approved_at, rejection_reason, created_at, owner_profile_id,
       approved_by_profile:profiles!exercises_approved_by_fkey(full_name)`
    )
    .eq('id', id)
    .eq('club_id', clubId)
    .is('archived_at', null)
    .maybeSingle();

  if (!data) return null;

  const parsed = data.diagram != null ? parseDiagram(data.diagram) : null;
  const approver = data.approved_by_profile as { full_name: string | null } | null;

  return {
    id: data.id as string,
    name: data.name as string,
    status: data.status as MethodologyStatus,
    categories: (data.categories as string[] | null) ?? [],
    tactical_objectives: (data.tactical_objectives as string[] | null) ?? [],
    technical_objectives: (data.technical_objectives as string[] | null) ?? [],
    physical_focus: (data.physical_focus as string | null) ?? null,
    intensity: (data.intensity as ExerciseIntensity | null) ?? null,
    space_type: (data.space_type as ExerciseSpaceType | null) ?? null,
    space_dimensions: (data.space_dimensions as string | null) ?? null,
    base_duration: (data.base_duration as number | null) ?? null,
    description: (data.description as string | null) ?? null,
    objective: (data.objective as string | null) ?? null,
    coaching_points: (data.coaching_points as string | null) ?? null,
    variants: (data.variants as string | null) ?? null,
    players: (data.players as string | null) ?? null,
    diagram: parsed && parsed.success ? parsed.data : null,
    approved_at: (data.approved_at as string | null) ?? null,
    approved_by_name: approver?.full_name ?? null,
    rejection_reason: (data.rejection_reason as string | null) ?? null,
    created_at: data.created_at as string,
    is_owner: user != null && data.owner_profile_id === user.id,
  };
}
