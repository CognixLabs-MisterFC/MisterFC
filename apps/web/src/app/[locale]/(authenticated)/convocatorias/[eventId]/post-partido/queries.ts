/**
 * F8.2 — Carga de la etapa POST-PARTIDO (valoraciones del partido).
 *
 * O2-9c — El grueso de la lectura se EXTRAJO a core (`getPostMatchFromClient`):
 * resultado final, stats consolidadas (7.10, contexto), valoraciones individuales,
 * valoración colectiva y permiso (RPC user_can_record_match). Aquí solo queda la
 * capa web: crear el cliente con cookie, y AÑADIR la nota privada del staff (F8.4,
 * `evaluation_private_notes`) que NO se extrajo — así el comportamiento web es
 * idéntico (la UI sigue viendo `privateNote`) sin duplicar el resto de la lectura.
 */

import {
  createSupabaseServerClient,
  getPostMatchFromClient,
  type PostMatchData as CorePostMatchData,
  type PostMatchPlayer as CorePostMatchPlayer,
  type PostMatchStats,
  type PostMatchEvaluation,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type { PostMatchStats, PostMatchEvaluation };

/** Jugador del post-partido = el del core + la nota privada del staff (F8.4). */
export type PostMatchPlayer = CorePostMatchPlayer & {
  /** F8.4 — nota privada del staff (interna, nunca visible a jugador/familia). */
  privateNote: string | null;
};

export type PostMatchData = Omit<CorePostMatchData, 'players'> & {
  players: PostMatchPlayer[];
};

export async function loadPostMatch(
  clubId: string,
  eventId: string,
): Promise<PostMatchData | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const core = await getPostMatchFromClient(supabase, clubId, eventId);
  if (!core) return null;

  // F8.4 — notas privadas del staff (internas). La RLS las restringe a staff;
  // esta query solo la usa el post-partido, ya gateado.
  const { data: privRows } = await supabase
    .from('evaluation_private_notes')
    .select('player_id, note')
    .eq('event_id', eventId);
  const privByPlayer = new Map<string, string>();
  for (const r of privRows ?? []) {
    privByPlayer.set(r.player_id as string, r.note as string);
  }

  return {
    ...core,
    players: core.players.map((p) => ({
      ...p,
      privateNote: privByPlayer.get(p.playerId) ?? null,
    })),
  };
}
