/**
 * F10.1/10.2 — Loaders del dashboard ejecutivo del club.
 *
 * O2-11b — la lógica de carga (queries + delegación en los agregadores puros de
 * core) se extrajo a `@misterfc/core` (`dashboard/queries.ts`); estos wrappers solo
 * crean el cliente de servidor (cookies) y delegan, conservando el comportamiento.
 * El único añadido web es el reporte de errores a Sentry, que se inyecta como
 * callback `onError` (core no depende de `@sentry/nextjs`).
 */

import {
  getClubDashboardBaseFromClient,
  getClubResultsFromClient,
  getClubAttendanceFromClient,
  getClubRankingsFromClient,
  getClubAlertsFromClient,
  getCampaignDeadlineAlertsFromClient,
  createSupabaseServerClient,
  type ClubDashboardBase,
  type DashboardSeasonContext,
  type ClubAttendanceData,
  type ClubRankingsData,
  type ClubAlertsData,
  type LowAttendanceAlertItem,
  type InactiveAlertItem,
  type CampaignDeadlineAlert,
  type TeamResults,
} from '@misterfc/core';
import * as Sentry from '@sentry/nextjs';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// Re-export de los tipos (la page y otros consumidores los importaban de aquí).
export type {
  ClubDashboardBase,
  DashboardSeasonContext,
  ClubAttendanceData,
  ClubRankingsData,
  ClubAlertsData,
  LowAttendanceAlertItem,
  InactiveAlertItem,
  CampaignDeadlineAlert,
  TeamResults,
};

async function serverClient() {
  return createSupabaseServerClient(await createCookieAdapter());
}

/** Reporte a Sentry del error de censo (comportamiento previo a la extracción). */
function reportCensusError(error: unknown, ctx: { clubId: string; season: string }) {
  Sentry.captureException(error, {
    tags: { feature: 'dashboard', step: 'season_census' },
    extra: { clubId: ctx.clubId, season: ctx.season },
  });
}

export async function loadClubDashboardBase(clubId: string): Promise<ClubDashboardBase> {
  const supabase = await serverClient();
  return getClubDashboardBaseFromClient(supabase, clubId, { onError: reportCensusError });
}

export async function loadClubResults(teamIds: readonly string[]): Promise<TeamResults[]> {
  const supabase = await serverClient();
  return getClubResultsFromClient(supabase, teamIds);
}

export async function loadClubAttendance(teamIds: readonly string[]): Promise<ClubAttendanceData> {
  const supabase = await serverClient();
  return getClubAttendanceFromClient(supabase, teamIds);
}

export async function loadClubRankings(teamIds: readonly string[]): Promise<ClubRankingsData> {
  const supabase = await serverClient();
  return getClubRankingsFromClient(supabase, teamIds);
}

export async function loadClubAlerts(teamIds: readonly string[]): Promise<ClubAlertsData> {
  const supabase = await serverClient();
  return getClubAlertsFromClient(supabase, teamIds);
}

export async function loadCampaignDeadlineAlerts(
  clubId: string,
  teamIds: readonly string[],
): Promise<CampaignDeadlineAlert[]> {
  const supabase = await serverClient();
  return getCampaignDeadlineAlertsFromClient(supabase, clubId, teamIds);
}
