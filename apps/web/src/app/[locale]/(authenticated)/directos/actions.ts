'use server';

/**
 * F7B-3 — Refetch ligero para el polling (~5s) de la pantalla "Directos".
 * Solo lectura; la RLS (F7B-2) filtra por pertenencia al club. No revalida.
 */

import { loadShellContext } from '@/lib/auth-shell';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import {
  loadWeekMatches,
  loadMatchDetail,
  type WeekMatch,
  type MatchDetail,
} from './queries';

/**
 * F14C-4 — club activo para el polling: el del miembro (shell normal) o, si no
 * hay membership, el club del nieto activo del SEGUIDOR PURO. El seguidor ve los
 * directos club-wide por RLS (F14C-3). El camino del miembro es IDÉNTICO al de
 * antes (ctx presente → mismo club); la rama del seguidor solo entra cuando NO
 * hay shell normal.
 */
async function pollingClub(): Promise<{
  clubId: string;
  viewerIsSpectator: boolean;
} | null> {
  const ctx = await loadShellContext();
  if (ctx) return { clubId: ctx.activeClub.club.id, viewerIsSpectator: false };
  const spec = await loadSpectatorContext();
  return spec
    ? { clubId: spec.activePlayer.clubId, viewerIsSpectator: true }
    : null;
}

export async function fetchWeekMatches(): Promise<WeekMatch[]> {
  const info = await pollingClub();
  if (!info) return [];
  return loadWeekMatches(info.clubId);
}

export async function fetchMatchDetail(
  eventId: string,
): Promise<MatchDetail | null> {
  const info = await pollingClub();
  if (!info) return null;
  // F14C-4b — el detalle del seguidor resuelve los nombres desde players_sporting.
  return loadMatchDetail(info.clubId, eventId, {
    viewerIsSpectator: info.viewerIsSpectator,
  });
}
