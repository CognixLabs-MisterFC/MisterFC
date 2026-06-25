/**
 * F13.10e — Route Handler que genera el PDF del INFORME DE DESARROLLO de un
 * jugador en un periodo (jugador×temporada×periodo). Molde de /sesiones/[id]/pdf
 * y /jugadores/[id]/pdf (9.B): cliente/sesión de la request → RLS heredada.
 *
 * Acceso (D13 + Regla #11): STAFF del club (ven borradores y publicados) y la
 * FAMILIA/JUGADOR (rol `jugador`) SOLO de un informe PUBLICADO suyo. No se abre
 * RLS: el cliente autenticado de la request ya recorta (la RLS de 13.10d deja al
 * jugador ver solo sus informes publicados); el PDF es un render de los MISMOS
 * datos que ya ve en /mi-informe.
 */

import { getTranslations } from 'next-intl/server';
import {
  createSupabaseServerClient,
  isDevelopmentPeriod,
  PLAYER_POSITIONS,
  type PlayerPosition,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadIndividualReport,
  loadPlayerObjectives,
  loadTeamObjectives,
  loadFichaStats,
  loadFichaMatchStatsByType,
  loadPlayerEvolution,
  loadTeamEvolution,
} from '../../queries';
import { DevelopmentReportPdfDocument } from '@/lib/pdf/development-report-pdf';
import { pdfResponse, slugForFile, type Translator } from '@/lib/pdf/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; playerId: string; period: string }> },
): Promise<Response> {
  const { locale, playerId, period } = await params;
  if (!isDevelopmentPeriod(period)) return new Response('Not found', { status: 404 });

  const ctx = await loadShellContext();
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const role = ctx.activeClub.role as Role;
  const isStaff = STAFF_ROLES.includes(role);
  const isFamily = role === 'jugador';
  if (!isStaff && !isFamily) return new Response('Forbidden', { status: 403 });

  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const clubId = ctx.activeClub.club.id;

  // Jugador (RLS: staff del club lo ve; la familia ve a su jugador).
  const { data: player } = await supabase
    .from('players')
    .select('first_name, last_name, club_id, date_of_birth, dorsal, position_main, foot')
    .eq('id', playerId)
    .maybeSingle();
  if (!player || player.club_id !== clubId) return new Response('Not found', { status: 404 });

  // Temporada: ?season= (label) si es válida; si no, la activa del club.
  const seasonParam = new URL(req.url).searchParams.get('season');
  const seasons = await loadClubSeasons(supabase, clubId);
  const activeLabel = await getActiveSeasonLabel(supabase, clubId);
  const seasonLabel =
    seasonParam && seasons.some((s) => s.label === seasonParam) ? seasonParam : activeLabel;
  const season = seasons.find((sn) => sn.label === seasonLabel) ?? null;
  if (!season) return new Response('Not found', { status: 404 });
  const seasonId = season.id;

  const team = await resolvePlayerTeamForSeason(supabase, playerId, seasonLabel);

  // Informe individual (RLS: la familia solo recibe el publicado suyo).
  const report = await loadIndividualReport(supabase, playerId, seasonId, period);
  if (!report) return new Response('Not found', { status: 404 });
  // Cinturón y tirantes: la familia solo descarga informes PUBLICADOS.
  if (isFamily && report.visibility !== 'team') {
    return new Response('Forbidden', { status: 403 });
  }

  // Valoración de equipo enlazada (la RLS helper de 13.10d la permite a la familia).
  let teamReport: { scores: Record<string, number>; comment: string | null } | null = null;
  if (report.team_report_id) {
    const { data: tr } = await supabase
      .from('team_development_reports')
      .select('scores, comment')
      .eq('id', report.team_report_id)
      .maybeSingle();
    if (tr) {
      teamReport = {
        scores: (tr.scores as Record<string, number>) ?? {},
        comment: (tr.comment as string | null) ?? null,
      };
    }
  }

  const [playerObjectives, teamObjectives, stats, matchStatsByType, evolution, teamEvolution] =
    await Promise.all([
      loadPlayerObjectives(supabase, playerId, seasonId),
      team ? loadTeamObjectives(supabase, team.teamId, seasonId) : Promise.resolve([]),
      loadFichaStats(supabase, playerId, seasonLabel, team?.teamId ?? null),
      loadFichaMatchStatsByType(supabase, playerId, seasonLabel),
      loadPlayerEvolution(supabase, playerId, seasonId),
      team ? loadTeamEvolution(supabase, team.teamId, seasonId) : Promise.resolve([]),
    ]);

  const { data: club } = await supabase.from('clubs').select('name').eq('id', clubId).maybeSingle();
  const clubName = club?.name ?? 'MisterFC';

  const t = (await getTranslations({ locale, namespace: 'pdf.development' })) as unknown as Translator;
  const tInf = (await getTranslations({ locale, namespace: 'informes' })) as unknown as Translator;
  const tPos = await getTranslations({ locale, namespace: 'jugadores.positions' });
  const tFoot = await getTranslations({ locale, namespace: 'jugadores.feet' });

  const primaryPos = (PLAYER_POSITIONS as readonly string[]).includes(player.position_main ?? '')
    ? (player.position_main as PlayerPosition)
    : null;
  const validFoot = player.foot && ['right', 'left', 'both'].includes(player.foot);
  const playerName = `${player.first_name} ${player.last_name ?? ''}`.trim();

  function ageFromDob(dob: string | null): number | null {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getUTCFullYear() - d.getUTCFullYear();
    const m = now.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
    return age;
  }

  const doc = DevelopmentReportPdfDocument({
    t,
    tInf,
    clubName,
    playerName,
    initials: (player.first_name[0] ?? '') + (player.last_name?.[0] ?? ''),
    dorsal: player.dorsal,
    positionLabel: primaryPos ? tPos(primaryPos) : null,
    footLabel: validFoot ? tFoot(player.foot as string) : null,
    age: ageFromDob(player.date_of_birth),
    teamName: team?.teamName ?? '',
    seasonLabel,
    period,
    scores: report.scores ?? {},
    commentOverall: report.comment_overall ?? null,
    teamReport,
    playerObjectives,
    teamObjectives,
    stats,
    matchStatsByType,
    evolution,
    teamEvolution,
  });

  return pdfResponse(
    doc,
    `${t('file')}-${slugForFile(playerName)}-${slugForFile(seasonLabel)}-${period}.pdf`,
  );
}
