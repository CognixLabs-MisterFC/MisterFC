/**
 * F13.10e — Route Handler que genera el PDF del INFORME DE DESARROLLO de un
 * jugador en un periodo (jugador×temporada×periodo). Molde de /sesiones/[id]/pdf
 * y /jugadores/[id]/pdf (9.B): cliente/sesión de la request → RLS heredada.
 *
 * Acceso: STAFF del club (ven borradores y publicados) y la FAMILIA SOLO de un
 * informe PUBLICADO suyo. No se abre RLS: el cliente autenticado de la request ya
 * recorta (la RLS de 13.10d deja al jugador ver solo sus informes publicados); el
 * PDF es un render de los MISMOS datos que ya ve en /mi-informe.
 *
 * DOS VÍAS DE IDENTIDAD (molde del expediente de RGPD, O2-5 F1): cookie de sesión
 * (web, idéntico a antes) o `Authorization: Bearer` (app nativa, que no tiene
 * cookie). Antes era solo cookie, así que la app recibía 401 y la descarga no
 * existía en el móvil.
 *
 * Y EL PORTERO DE LA FAMILIA YA NO ES EL ROL DE CLUB. Antes se exigía
 * `role === 'jugador'`, lo que ataba la descarga a la forma en que se modela una
 * familia (una membresía con ese rol). Ahora se pregunta por el VÍNCULO con el
 * jugador, como el expediente:
 *  · `user_manages_player_sensitive` — tutor vinculado, o el propio jugador si ya
 *    es mayor de edad. Es el mismo helper que usa /mi-ficha/export.
 *  · `user_is_player_self` — Y ADEMÁS la cuenta propia del MENOR. El expediente la
 *    deja fuera a propósito (es uno de los bloques que Jose reserva al tutor), pero
 *    este informe no es dato sensible: es lo que el menor ya ve en su propia
 *    pantalla de Mi informe. Sin esta segunda pregunta, las 2 cuentas propias de
 *    menor que hay hoy perderían una descarga que la web sí les daba.
 * Consecuencia buscada: un director o entrenador que ADEMÁS sea tutor descarga el
 * informe de su hijo, cosa que con el gate por rol le daba 403.
 *
 * Y la suma de las dos preguntas es, a propósito, EXACTAMENTE la rama de familia de
 * la RLS de `development_reports` (`visibility='team' AND user_is_account_of_player`):
 * `relation` solo admite self/parent/guardian por CHECK, así que tutor ∪ propio = todo
 * vínculo. El portero no estrecha ni ensancha lo que la RLS ya deja leer; se escriben
 * las dos por separado porque así queda dicho POR QUÉ entra el menor con cuenta propia
 * —para que nadie lo "endurezca" al gate sensible y le quite lo que ya ve en pantalla—.
 * Si algún día aparece una cuarta `relation`, hay que volver aquí.
 */

import { getTranslations } from 'next-intl/server';
import {
  isDevelopmentPeriod,
  PLAYER_POSITIONS,
  STAFF_ROLES,
  type PlayerPosition,
  type Role,
} from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { getActiveSeasonLabel } from '@/lib/active-season';
import {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadIndividualReport,
  loadPlayerObjectives,
  loadTeamObjectives,
  loadFichaStats,
  loadPlayerEvolution,
  loadTeamEvolution,
} from '../../queries';
import { DevelopmentReportPdfDocument } from '@/lib/pdf/development-report-pdf';
import { pdfResponse, slugForFile, type Translator } from '@/lib/pdf/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; playerId: string; period: string }> },
): Promise<Response> {
  const { locale, playerId, period } = await params;
  if (!isDevelopmentPeriod(period)) return new Response('Not found', { status: 404 });

  // Cookie (web) o bearer (app nativa). Cliente RLS-scoped al usuario, nunca admin.
  const auth = await resolveUserFromRequest(req);
  if (!auth) return new Response('Unauthorized', { status: 401 });
  const { user, supabase, shell } = auth;

  // Jugador (RLS: staff del club lo ve; la familia ve a su jugador).
  const { data: player } = await supabase
    .from('players')
    .select('first_name, last_name, club_id, date_of_birth, dorsal, position_main, positions_secondary, foot')
    .eq('id', playerId)
    .maybeSingle();
  if (!player) return new Response('Not found', { status: 404 });
  // Camino COOKIE: se conserva EXACTA la comprobación de club activo de antes. En
  // bearer no hay club activo, así que el club se deriva del propio jugador.
  if (shell && player.club_id !== shell.activeClub.club.id) {
    return new Response('Not found', { status: 404 });
  }
  const clubId = player.club_id;

  // Rol en el club DEL JUGADOR. En cookie se lee del shell —idéntico a antes, y así
  // el club sintético del superadmin (F14B-8), que no tiene membresía real, sigue
  // entrando—; en bearer sale de la membresía viva en ese club.
  let role: Role | null = shell ? (shell.activeClub.role as Role) : null;
  if (!shell) {
    const { data: membership } = await supabase
      .from('memberships')
      .select('role')
      .eq('profile_id', user.id)
      .eq('club_id', clubId)
      .is('left_at', null)
      .maybeSingle();
    role = (membership?.role ?? null) as Role | null;
  }
  const isStaff = role != null && STAFF_ROLES.includes(role);

  // La familia entra por el VÍNCULO, no por el rol (ver cabecera). Solo se pregunta
  // si no es staff: quien ya pasa por staff no necesita el vínculo.
  let isFamily = false;
  if (!isStaff) {
    const { data: manages } = await supabase.rpc('user_manages_player_sensitive', {
      p_player_id: playerId,
    });
    isFamily = manages === true;
    if (!isFamily) {
      // La cuenta propia del menor: ve su informe en pantalla, se lo puede llevar.
      const { data: isSelf } = await supabase.rpc('user_is_player_self', {
        p_player_id: playerId,
      });
      isFamily = isSelf === true;
    }
  }
  if (!isStaff && !isFamily) return new Response('Forbidden', { status: 403 });

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
  // Cinturón y tirantes: quien no es staff solo descarga informes PUBLICADOS. La RLS
  // ya no le devolvería un borrador, pero la condición se queda escrita aquí.
  if (!isStaff && report.visibility !== 'team') {
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

  const [playerObjectives, teamObjectives, stats, evolution, teamEvolution] =
    await Promise.all([
      loadPlayerObjectives(supabase, playerId, seasonId),
      team ? loadTeamObjectives(supabase, team.teamId, seasonId) : Promise.resolve([]),
      loadFichaStats(supabase, playerId, seasonLabel, team?.teamId ?? null),
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
    primaryPos,
    secondaryPos: (player.positions_secondary ?? []) as string[],
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
    evolution,
    teamEvolution,
    locale,
  });

  return pdfResponse(
    doc,
    `${t('file')}-${slugForFile(playerName)}-${slugForFile(seasonLabel)}-${period}.pdf`,
  );
}
