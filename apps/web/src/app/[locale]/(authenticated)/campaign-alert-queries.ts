/**
 * F13.10g-GB — Alerta "campaña de evaluación abierta" para Inicio.
 *
 * Audiencia (molde 12.8b): cuerpo técnico → SUS equipos (team_staff activo);
 * admin/coord → todo el club; jugador/familia → []. Para cada campaña LANZADA
 * (status='launched') de la temporada activa con informes PENDIENTES de la
 * audiencia (roster activo sin informe completo, D6), devuelve periodo + fecha
 * límite + nº pendientes. Sin migración (lee assessment_campaigns + development_reports).
 */

import {
  createSupabaseServerClient,
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type CampaignAlert = {
  period: string;
  dueDate: string; // YYYY-MM-DD
  pending: number;
};

const COACH_ROLES = new Set<string>(['entrenador_principal', 'entrenador_ayudante']);
const ADMIN_LIKE_ROLES = new Set<string>(['admin_club', 'coordinador']);

export async function loadCampaignAlerts(
  role: string,
  clubId: string,
  membershipId: string,
): Promise<CampaignAlert[]> {
  const isCoach = COACH_ROLES.has(role);
  const isAdminLike = ADMIN_LIKE_ROLES.has(role);
  if (!isCoach && !isAdminLike) return [];

  const supabase = createSupabaseServerClient(await createCookieAdapter());

  // Temporada activa.
  const { data: season } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return [];
  const seasonId = season.id as string;
  const seasonLabel = season.label as string;

  // Campañas lanzadas de la temporada.
  const { data: campaignRows } = await supabase
    .from('assessment_campaigns')
    .select('period, due_date, status')
    .eq('season_id', seasonId)
    .eq('status', 'launched');
  const launched = ((campaignRows ?? []) as Array<{ period: string; due_date: string | null }>)
    .filter((c) => c.due_date)
    .map((c) => ({ period: c.period, dueDate: c.due_date as string }));
  if (launched.length === 0) return [];

  // Equipos de la audiencia.
  let teamIds: string[];
  if (isCoach) {
    const { data: staffRows } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('membership_id', membershipId)
      .is('left_at', null);
    teamIds = (staffRows ?? []).map((r) => r.team_id as string);
  } else {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, categories!inner(club_id)')
      .eq('season', seasonLabel)
      .eq('categories.club_id', clubId);
    teamIds = ((teamRows ?? []) as unknown as Array<{ id: string }>).map((t) => t.id);
  }
  if (teamIds.length === 0) return [];

  // Roster activo de esos equipos (player_ids).
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('player_id')
    .in('team_id', teamIds)
    .is('left_at', null);
  const rosterIds = new Set((rosterRows ?? []).map((r) => r.player_id as string));
  const total = rosterIds.size;
  if (total === 0) return [];

  // Informes del periodo (de esos equipos) → completados por jugador del roster.
  const periods = launched.map((l) => l.period);
  const { data: reportRows } = await supabase
    .from('development_reports')
    .select('player_id, period, scores')
    .eq('season_id', seasonId)
    .in('team_id', teamIds)
    .in('period', periods);
  const completedByPeriod = new Map<string, Set<string>>();
  for (const r of (reportRows ?? []) as Array<{
    player_id: string;
    period: string;
    scores: Record<string, number>;
  }>) {
    if (
      rosterIds.has(r.player_id) &&
      reportStatus(r.scores ?? {}, DEVELOPMENT_REPORT_CATALOG) === 'completed'
    ) {
      const set = completedByPeriod.get(r.period) ?? new Set<string>();
      set.add(r.player_id);
      completedByPeriod.set(r.period, set);
    }
  }

  return launched
    .map((l) => ({
      period: l.period,
      dueDate: l.dueDate,
      pending: total - (completedByPeriod.get(l.period)?.size ?? 0),
    }))
    .filter((a) => a.pending > 0);
}
