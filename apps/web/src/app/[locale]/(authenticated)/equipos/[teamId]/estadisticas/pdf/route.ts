/**
 * F9.B-7 — Route Handler que genera el PDF de estadísticas del equipo.
 *
 * RLS heredada (D7): mismo cliente/sesión que la página; las stats las recorta
 * la RLS de 9.B-0 (`match_player_stats_select`). Acceso: admin/coord (cualquier
 * equipo del club) o coach de ESE equipo (userStaffsTeam). Sin badges en v1.
 */

import { getTranslations } from 'next-intl/server';
import { createSupabaseServerClient, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { loadTeamSeasonStats } from '../../team-stats-queries';
import { userStaffsTeam } from '../../../../estadisticas-equipo/queries';
import { TeamPdfDocument } from '@/lib/pdf/team-pdf';
import { pdfResponse, slugForFile, type Translator } from '@/lib/pdf/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];
const COACH_ROLES: ReadonlyArray<Role> = [
  'entrenador_principal',
  'entrenador_ayudante',
];

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

  const doc = TeamPdfDocument({
    t,
    clubName,
    teamName: data.team.name,
    categoryName: data.team.category_name,
    season: data.team.season,
    aggregate: data.aggregate,
  });

  return pdfResponse(
    doc,
    `${t('team.file')}-${slugForFile(data.team.name)}-${data.team.season}.pdf`
  );
}
