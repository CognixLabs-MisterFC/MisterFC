/**
 * F7.x (X.3) — Route Handler que genera el PDF de estadísticas del partido.
 *
 * RLS heredada (como los PDFs de 9.B y la pantalla de X.1): corre con la sesión
 * del usuario y REUSA `loadMatchStats` (X.1), así que el control de acceso no se
 * duplica. STAFF obtiene el PDF completo (marcador + tabla + panel de equipo);
 * la FAMILIA, solo la fila de su hijo (sin marcador ni panel). No es puerta
 * trasera. Solo partidos cerrados. Sin gráficos ni timeline (v1: tablas).
 */

import { getTranslations } from 'next-intl/server';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { MatchPdfDocument } from '@/lib/pdf/match-pdf';
import { pdfResponse, slugForFile, type Translator } from '@/lib/pdf/shared';
import { loadMatchStats } from '../queries';
import type { Role } from '../../../../jugadores/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmtDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; eventId: string }> },
): Promise<Response> {
  const { locale, eventId } = await params;

  const ctx = await loadShellContext();
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const role = ctx.activeClub.role as Role;
  const result = await loadMatchStats(
    ctx.activeClub.club.id,
    eventId,
    ctx.user.id,
    role,
  );

  if (result.status === 'not_found') return new Response('Not found', { status: 404 });
  if (result.status === 'empty') return new Response('Not found', { status: 404 });
  if (result.status === 'not_closed' || result.status === 'forbidden') {
    return new Response('Forbidden', { status: 403 });
  }

  const { view } = result;
  const { event } = view;

  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const { data: club } = await supabase
    .from('clubs')
    .select('name')
    .eq('id', ctx.activeClub.club.id)
    .maybeSingle();
  const clubName = club?.name ?? 'MisterFC';

  const t = (await getTranslations({
    locale,
    namespace: 'pdf',
  })) as unknown as Translator;

  const doc = MatchPdfDocument({
    t,
    clubName,
    teamName: event.teamName,
    opponentName: event.opponentName,
    dateLabel: fmtDate(event.startsAt, locale),
    viewer: view.viewer,
    score: view.viewer === 'staff' ? view.score : null,
    players: view.players,
    team: view.viewer === 'staff' ? view.team : null,
  });

  const label = event.opponentName ?? event.title;
  return pdfResponse(
    doc,
    `${t('match.file')}-${slugForFile(label)}-${event.startsAt.slice(0, 10)}.pdf`,
  );
}
