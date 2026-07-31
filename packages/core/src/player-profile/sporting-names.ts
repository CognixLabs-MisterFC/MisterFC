import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

/**
 * F14C-4b — Resuelve nombre/dorsal de jugadores desde `players_sporting` (la vista
 * DEPORTIVA de F14C-3, legible por el SEGUIDOR; `players` está cerrada por RLS).
 * Devuelve un mapa `player_id → {first_name, last_name, dorsal}`. Solo columnas
 * deportivas — nada personal.
 *
 * O2-5 B2 — extraído de `apps/web/src/lib/spectator-names.ts` (patrón A/B1). Se usa
 * SOLO en la rama del seguidor de los loaders reutilizados (estadísticas de equipo,
 * detalle de directo). Los miembros siguen leyendo de `players`, sin cambios.
 */
type DbClient = SupabaseClient<Database>;

export type SportingName = {
  first_name: string | null;
  last_name: string | null;
  dorsal: number | null;
};

export async function getSportingNamesFromClient(
  supabase: DbClient,
  playerIds: (string | null | undefined)[]
): Promise<Map<string, SportingName>> {
  const ids = [...new Set(playerIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('players_sporting')
    .select('id, first_name, last_name, dorsal')
    .in('id', ids);
  const map = new Map<string, SportingName>();
  for (const p of data ?? []) {
    if (p.id) {
      map.set(p.id, {
        first_name: p.first_name,
        last_name: p.last_name,
        dorsal: p.dorsal,
      });
    }
  }
  return map;
}
