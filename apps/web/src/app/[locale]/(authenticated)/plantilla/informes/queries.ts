/**
 * F13.10g-GB — Lecturas del centro de mando de campañas de evaluación (admin/coord).
 * Agrega club-wide por periodo: por cada equipo de la temporada activa, sus
 * entrenadores (team_staff), y completados vs pendientes (roster activo vs informes
 * individuales con reportStatus='completed', D6). El estado de la campaña sale de
 * assessment_campaigns (GA).
 */

import {
  createSupabaseServerClient,
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
  type AssessmentCampaignStatus,
} from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

export type ActiveSeason = { id: string; label: string };

/** Temporada activa del club (status='active'); la más reciente si hubiera varias. */
export async function loadActiveSeason(supabase: Supa, clubId: string): Promise<ActiveSeason | null> {
  const { data } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, label: data.label as string } : null;
}

export type CampaignRow = {
  id: string;
  status: AssessmentCampaignStatus;
  dueDate: string | null;
};

/** Campaña de un periodo (null si aún no se configuró). */
export async function loadCampaign(
  supabase: Supa,
  seasonId: string,
  period: string,
): Promise<CampaignRow | null> {
  const { data } = await supabase
    .from('assessment_campaigns')
    .select('id, status, due_date')
    .eq('season_id', seasonId)
    .eq('period', period)
    .maybeSingle();
  return data
    ? {
        id: data.id as string,
        status: data.status as AssessmentCampaignStatus,
        dueDate: (data.due_date as string | null) ?? null,
      }
    : null;
}

export type TeamProgress = {
  teamId: string;
  teamName: string;
  coaches: string[];
  total: number;
  completed: number;
  pending: number;
};

/**
 * Matriz de progreso del periodo: una fila por equipo de la temporada activa con
 * sus entrenadores y completados/pendientes (sobre el roster activo). Pocas queries
 * acotadas por los teamIds del club.
 */
export async function loadCampaignMatrix(
  supabase: Supa,
  clubId: string,
  seasonLabel: string,
  seasonId: string,
  period: string,
): Promise<TeamProgress[]> {
  // 1) Equipos de la temporada activa (del club).
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, categories!inner(club_id)')
    .eq('season', seasonLabel)
    .eq('categories.club_id', clubId);
  const teams = ((teamRows ?? []) as unknown as Array<{ id: string; name: string }>).map((t) => ({
    id: t.id,
    name: t.name,
  }));
  if (teams.length === 0) return [];
  const teamIds = teams.map((t) => t.id);

  // 2) Entrenadores (team_staff activo) + 3) roster activo + 4) informes del periodo.
  const [{ data: staffRows }, { data: rosterRows }, { data: reportRows }] = await Promise.all([
    supabase
      .from('team_staff')
      .select('team_id, staff_role, memberships!inner(profiles!inner(full_name))')
      .in('team_id', teamIds)
      .is('left_at', null)
      .in('staff_role', ['entrenador_principal', 'entrenador_ayudante']),
    supabase
      .from('team_members')
      .select('team_id, player_id')
      .in('team_id', teamIds)
      .is('left_at', null),
    supabase
      .from('development_reports')
      .select('team_id, player_id, scores')
      .eq('season_id', seasonId)
      .eq('period', period)
      .in('team_id', teamIds),
  ]);

  const coachesByTeam = new Map<string, string[]>();
  for (const r of (staffRows ?? []) as unknown as Array<{
    team_id: string;
    memberships: { profiles: { full_name: string | null } };
  }>) {
    const name = r.memberships?.profiles?.full_name ?? '—';
    const arr = coachesByTeam.get(r.team_id) ?? [];
    if (!arr.includes(name)) arr.push(name);
    coachesByTeam.set(r.team_id, arr);
  }

  const rosterByTeam = new Map<string, Set<string>>();
  for (const r of (rosterRows ?? []) as Array<{ team_id: string; player_id: string }>) {
    const set = rosterByTeam.get(r.team_id) ?? new Set<string>();
    set.add(r.player_id);
    rosterByTeam.set(r.team_id, set);
  }

  // Informes completos por equipo→jugador.
  const completedByTeam = new Map<string, Set<string>>();
  for (const r of (reportRows ?? []) as Array<{
    team_id: string;
    player_id: string;
    scores: Record<string, number>;
  }>) {
    if (reportStatus(r.scores ?? {}, DEVELOPMENT_REPORT_CATALOG) === 'completed') {
      const set = completedByTeam.get(r.team_id) ?? new Set<string>();
      set.add(r.player_id);
      completedByTeam.set(r.team_id, set);
    }
  }

  return teams
    .map((t) => {
      const roster = rosterByTeam.get(t.id) ?? new Set<string>();
      const completedSet = completedByTeam.get(t.id) ?? new Set<string>();
      // Solo cuentan como completados los jugadores que siguen en el roster.
      let completed = 0;
      for (const pid of roster) if (completedSet.has(pid)) completed += 1;
      const total = roster.size;
      return {
        teamId: t.id,
        teamName: t.name,
        coaches: coachesByTeam.get(t.id) ?? [],
        total,
        completed,
        pending: total - completed,
      };
    })
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}
