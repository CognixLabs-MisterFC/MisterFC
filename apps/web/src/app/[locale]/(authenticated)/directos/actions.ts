'use server';

/**
 * F7B-3 — Refetch ligero para el polling (~5s) de la pantalla "Directos".
 * Solo lectura; la RLS (F7B-2) filtra por pertenencia al club. No revalida.
 */

import { loadShellContext } from '@/lib/auth-shell';
import {
  loadWeekMatches,
  loadMatchDetail,
  type WeekMatch,
  type MatchDetail,
} from './queries';

export async function fetchWeekMatches(): Promise<WeekMatch[]> {
  const ctx = await loadShellContext();
  if (!ctx) return [];
  return loadWeekMatches(ctx.activeClub.club.id);
}

export async function fetchMatchDetail(
  eventId: string,
): Promise<MatchDetail | null> {
  const ctx = await loadShellContext();
  if (!ctx) return null;
  return loadMatchDetail(ctx.activeClub.club.id, eventId);
}
