/**
 * F12.5 — Route Handler que genera el PDF de la hoja de sesión (D6).
 *
 * RLS heredada (D7): mismo cliente/sesión que la página; loadSessionForPdf se
 * scopea al club activo y la RLS de 12.1 decide la visibilidad. Acceso: STAFF del
 * club (la hoja de sesión es para el cuerpo técnico). Sin diagramas (follow-up).
 */

import { getTranslations } from 'next-intl/server';
import { createSupabaseServerClient, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { loadSessionForPdf } from '../../queries';
import { SessionPdfDocument } from '@/lib/pdf/session-pdf';
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
  _req: Request,
  { params }: { params: Promise<{ locale: string; id: string }> }
): Promise<Response> {
  const { locale, id } = await params;

  const ctx = await loadShellContext();
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) return new Response('Forbidden', { status: 403 });

  const session = await loadSessionForPdf(ctx.activeClub.club.id, id);
  if (!session) return new Response('Not found', { status: 404 });

  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const { data: club } = await supabase
    .from('clubs')
    .select('name')
    .eq('id', ctx.activeClub.club.id)
    .maybeSingle();
  const clubName = club?.name ?? 'MisterFC';

  const t = (await getTranslations({ locale, namespace: 'pdf' })) as unknown as Translator;
  const tTactical = (await getTranslations({
    locale,
    namespace: 'ejercicios.tactical',
  })) as unknown as Translator;
  const tTechnical = (await getTranslations({
    locale,
    namespace: 'ejercicios.technical',
  })) as unknown as Translator;

  const doc = SessionPdfDocument({ t, tTactical, tTechnical, clubName, session });

  const datePart = session.session_date ?? 'sesion';
  const namePart = session.title ?? session.team_name ?? 'sesion';
  return pdfResponse(doc, `${t('session.file')}-${slugForFile(namePart)}-${datePart}.pdf`);
}
