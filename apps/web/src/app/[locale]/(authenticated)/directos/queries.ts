/**
 * F7B-3 / O2-5 — Carga de la pantalla "Directos" (SOLO LECTURA). La lógica de
 * fetch (listado de la semana y detalle del directo) vive en `@misterfc/core`
 * (`getWeekMatchesFromClient`, `getMatchDetailFromClient`), que reutiliza el motor
 * puro de match/* (matchPhase, computeScore, aggregateMatchTeamStats). Estas
 * funciones son WRAPPERS que construyen el cliente RLS y delegan — firma y
 * comportamiento idénticos. La RLS de F7B-2 abre la lectura a cualquier miembro
 * del club (y al SEGUIDOR club-wide, F14C).
 */

import {
  createSupabaseServerClient,
  getWeekMatchesFromClient,
  getMatchDetailFromClient,
  weekBounds,
  type WeekMatch,
  type MatchDetail,
  type DetailFieldPlayer,
  type DetailEvent,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// Tipos/helper compartidos viven en core; web los re-exporta para no divergir.
export { weekBounds };
export type { WeekMatch, MatchDetail, DetailFieldPlayer, DetailEvent };

/**
 * Partidos (match/friendly, incl. sub-partidos de torneo) de la semana natural
 * del club, con estado y marcador. Wrapper de `getWeekMatchesFromClient` (core).
 */
export async function loadWeekMatches(clubId: string): Promise<WeekMatch[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getWeekMatchesFromClient(supabase, clubId);
}

/**
 * Detalle de un directo (campo + alineaciones + timeline + marcador), acotado al
 * club. Wrapper de `getMatchDetailFromClient` (core). `opts.viewerIsSpectator`
 * resuelve nombres desde players_sporting (rama del seguidor).
 */
export async function loadMatchDetail(
  clubId: string,
  eventId: string,
  opts?: { viewerIsSpectator?: boolean },
): Promise<MatchDetail | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getMatchDetailFromClient(supabase, clubId, eventId, opts);
}
