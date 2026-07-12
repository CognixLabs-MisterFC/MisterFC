import type { createSupabaseServerClient } from '@misterfc/core';

export type SportingName = {
  first_name: string | null;
  last_name: string | null;
  dorsal: number | null;
};

/**
 * F14C-4b — Resuelve nombre/dorsal de jugadores desde `players_sporting` (la
 * vista deportiva de F14C-3, legible por el SEGUIDOR; `players` está cerrada por
 * RLS). Devuelve un mapa `player_id → {first_name, last_name, dorsal}`. Solo
 * columnas DEPORTIVAS — nada personal (ni fecha_nac ni contacto).
 *
 * Se usa SOLO en la rama del seguidor de los loaders reutilizados (estadísticas,
 * directo-detalle). Los miembros siguen leyendo de `players`, sin cambios.
 */
export async function loadSportingNames(
  supabase: ReturnType<typeof createSupabaseServerClient>,
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
