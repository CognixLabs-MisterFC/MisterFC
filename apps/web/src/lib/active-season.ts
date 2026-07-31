import {
  getActiveSeasonLabelFromClient,
  type createSupabaseServerClient,
} from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

/**
 * Rework C (C5) — temporada ACTIVA del club. O2-5 B1: la query se extrajo a core
 * (`getActiveSeasonLabelFromClient`); esto es un wrapper de compatibilidad, misma
 * firma y comportamiento.
 */
export function getActiveSeasonLabel(
  supabase: Supa,
  clubId: string
): Promise<string> {
  return getActiveSeasonLabelFromClient(supabase, clubId);
}
