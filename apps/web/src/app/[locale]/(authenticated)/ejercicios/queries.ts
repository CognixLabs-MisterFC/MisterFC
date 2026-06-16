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
  page: number
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
