import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { parsePlay, emptyPlay, type Play } from '../diagram/play';
import { isStrategyType, type PlaySignalId, type StrategyType } from './signals';

/**
 * O2-5 D2 — FETCH del PLAYBOOK del jugador/familia (visor de jugadas, SOLO LECTURA),
 * extraído de `apps/web/.../jugadas/queries.ts`. El MODELO de la jugada (schema +
 * interpolación `sceneAtTime`) ya vive en core (diagram/play.ts); aquí solo se
 * extrae el FETCH. Vía `team_plays` (shared_with_family=true); la RLS es el gate
 * (familia ve solo las jugadas compartidas de su equipo). Comportamiento idéntico.
 */
type DbClient = SupabaseClient<Database>;

// ── Listado del playbook (compartidas con la familia) ──────────────────────────
export type PlaybookRow = {
  id: string;
  name: string | null;
  frame_count: number;
  updated_at: string;
  /** Seña del equipo para la jugada (team_plays.signal_id; null = sin elegir). */
  signal_id: PlaySignalId | null;
  /** Tipo de estrategia de la jugada (plays.strategy_type; null = sin categoría). */
  strategy_type: StrategyType | null;
};

export async function getTeamPlaybookFromClient(
  supabase: DbClient,
  teamId: string,
): Promise<PlaybookRow[]> {
  const { data } = await supabase
    .from('team_plays')
    .select('signal_id, play:plays!inner(id, name, play, updated_at, strategy_type)')
    .eq('team_id', teamId)
    .eq('shared_with_family', true);

  type RawRow = {
    signal_id: string | null;
    play: {
      id: string;
      name: string | null;
      play: unknown;
      updated_at: string;
      strategy_type?: string | null;
    } | null;
  };
  const rows = ((data ?? []) as unknown as RawRow[])
    .filter((tp): tp is RawRow & { play: NonNullable<RawRow['play']> } => tp.play != null)
    .map((tp) => {
      const p = tp.play;
      const parsed = parsePlay(p.play);
      return {
        id: p.id,
        name: p.name ?? null,
        frame_count: parsed.success ? parsed.data.frames.length : 0,
        updated_at: p.updated_at,
        signal_id: (tp.signal_id as PlaySignalId | null) ?? null,
        strategy_type: isStrategyType(p.strategy_type) ? p.strategy_type : null,
      };
    });
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return rows;
}

// ── Una jugada (jsonb + seña) para el visor ────────────────────────────────────
export type TeamPlay = {
  id: string;
  name: string | null;
  play: Play;
  /** Seña que ESTE equipo usa para la jugada (team_plays.signal_id; null = sin elegir). */
  signal_id: PlaySignalId | null;
};

export async function getTeamPlayFromClient(
  supabase: DbClient,
  clubId: string,
  id: string,
): Promise<TeamPlay | null> {
  // La RLS de team_plays acota a las del equipo del jugador → la seña que sale es la
  // de SU equipo. (Si estuviera en varios equipos, `limit(1)` toma una; caso borde.)
  const { data: share } = await supabase
    .from('team_plays')
    .select('play_id, signal_id')
    .eq('play_id', id)
    .eq('shared_with_family', true)
    .limit(1)
    .maybeSingle();
  if (!share) return null;

  const { data } = await supabase
    .from('plays')
    .select('id, name, play')
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();
  if (!data) return null;

  const parsed = parsePlay(data.play);
  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    play: parsed.success ? parsed.data : emptyPlay(),
    signal_id: (share.signal_id as PlaySignalId | null) ?? null,
  };
}
