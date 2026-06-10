import {
  activeSeasonLabel,
  createSupabaseServerClient,
  currentSeason,
} from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

/**
 * Rework C (C5) — "¿en qué temporada operamos?" = la temporada ACTIVA del club
 * (seasons.status='active'), NO el reloj. Si por lo que sea no hubiese activa
 * (no debería tras el backfill de C5), cae a currentSeason() como label seguro.
 *
 * Es la fuente de verdad para los defaults de alta de equipo, selectores e import.
 */
export async function getActiveSeasonLabel(
  supabase: Supa,
  clubId: string
): Promise<string> {
  const { data } = await supabase
    .from('seasons')
    .select('label, status')
    .eq('club_id', clubId);
  return activeSeasonLabel(data ?? []) ?? currentSeason();
}
