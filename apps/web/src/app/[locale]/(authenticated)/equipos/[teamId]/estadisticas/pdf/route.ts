/**
 * F9.B-7 — Route Handler que genera el PDF de estadísticas del equipo.
 *
 * RLS heredada (D7): mismo cliente/sesión que la página; las stats las recorta
 * la RLS de 9.B-0 (`match_player_stats_select`). Acceso: admin/coord (cualquier
 * equipo del club) o coach de ESE equipo (userStaffsTeam). Sin badges en v1.
 */

import { getTranslations } from 'next-intl/server';
import { COACH_ROLES, STAFF_ROLES, createSupabaseServerClient, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { loadTeamSeasonStats } from '../../team-stats-queries';
import { userStaffsTeam } from '../../../../estadisticas-equipo/queries';
import { TeamPdfDocument } from '@/lib/pdf/team-pdf';
import { buildTeamByTypeRows } from '@/lib/team-stats-rows';
import { pdfResponse, slugForFile, type Translator } from '@/lib/pdf/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; teamId: string }> }
): Promise<Response> {
  const { locale, teamId } = await params;

  const ctx = await loadShellContext();
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) {
    return new Response('Forbidden', { status: 403 });
  }

  const data = await loadTeamSeasonStats(teamId);
  if (!data || data.team.club_id !== ctx.activeClub.club.id) {
    return new Response('Not found', { status: 404 });
  }
  if (COACH_ROLES.includes(role)) {
    const ok = await userStaffsTeam(ctx.activeClub.membershipId, teamId);
    if (!ok) return new Response('Forbidden', { status: 403 });
  }

  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const { data: club } = await supabase
    .from('clubs')
    .select('name')
    .eq('id', data.team.club_id)
    .maybeSingle();
  const clubName = club?.name ?? 'MisterFC';

  const t = (await getTranslations({
    locale,
    namespace: 'pdf',
  })) as unknown as Translator;

  // F9B-4b — filas/columnas del bloque "Totales del equipo" por tipo, con las
  // MISMAS labels que la web (equipo_stats.col_full + informes.ficha.*), vía el
  // constructor compartido buildTeamByTypeRows (sin divergencia web/PDF).
  const tEq = await getTranslations({ locale, namespace: 'equipo_stats' });
  const tInf = await getTranslations({ locale, namespace: 'informes' });
  const byTypeRows = buildTeamByTypeRows(data.byType, (key) =>
    tEq(`col_full.${key}`),
  );
  const byTypeColumns = {
    friendly: tInf('ficha.friendly'),
    tournament: tInf('ficha.tournament'),
    official: tInf('ficha.official'),
    total: tInf('ficha.total'),
    rival: tEq('rival'),
  };

  const doc = TeamPdfDocument({
    t,
    clubName,
    teamName: data.team.name,
    categoryName: data.team.category_name,
    season: data.team.season,
    aggregate: data.aggregate,
    byTypeTitle: tEq('by_type_title'),
    byTypeColumns,
    byTypeRows,
  });

  return pdfResponse(
    doc,
    `${t('team.file')}-${slugForFile(data.team.name)}-${data.team.season}.pdf`
  );
}
