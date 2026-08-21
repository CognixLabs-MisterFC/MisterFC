import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { activeSeasonLabel, currentSeason, seasonStartIso } from '../schemas/club-structure';

/**
 * O2-5 B1 — Label de la temporada ACTIVA del club, extraído de
 * `apps/web/src/lib/active-season.ts` (que ahora es un wrapper). Query pura sobre
 * `seasons`; si no hay activa, cae a `currentSeason()` como label seguro.
 */
export async function getActiveSeasonLabelFromClient(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<string> {
  const { data } = await supabase
    .from('seasons')
    .select('label, status')
    .eq('club_id', clubId);
  return activeSeasonLabel(data ?? []) ?? currentSeason();
}

/**
 * Fecha de INICIO (ISO UTC) de la temporada ACTIVA del club: el 1 de agosto de su
 * año inicial. Es el criterio CORRECTO para "desde el principio de la temporada"
 * (histórico de entrenamientos, J3) — la temporada activa la fija `seasons`, no el
 * reloj, así que en agosto no excluye la temporada recién jugada.
 */
export async function getActiveSeasonStartIsoFromClient(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<string> {
  const label = await getActiveSeasonLabelFromClient(supabase, clubId);
  return seasonStartIso(label);
}
