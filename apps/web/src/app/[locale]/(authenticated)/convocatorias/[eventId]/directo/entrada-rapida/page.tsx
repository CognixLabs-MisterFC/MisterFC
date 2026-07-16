import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { STAFF_ROLES } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadMatchLive } from '../queries';
import { QuickEntryClient } from '../_components/quick-entry-client';
import type { Role } from '../../../../jugadores/queries';

// F14H — misma hidratación dinámica que el Directo: leer siempre el estado real
// (eventos, reloj, status) al entrar/recargar, sin RSC cacheado.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ locale: string; eventId: string }>;
};

export default async function QuickEntryPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  // Gate grueso por rol; el autoritativo es user_can_record_match dentro de
  // loadMatchLive (cuerpo técnico del equipo + admin/coordinador). Sin cambios.
  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) {
    redirect(`/${locale}/convocatorias/${eventId}`);
  }

  const data = await loadMatchLive(ctx.activeClub.club.id, eventId);
  if (!data) notFound();

  const t = await getTranslations('partido_directo');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/convocatorias/${eventId}/directo`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('quick.back_to_live')}</span>
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          {data.event.title}
          {data.event.opponentName ? ` · vs ${data.event.opponentName}` : ''}
          {' · '}
          {data.event.teamName} · {data.event.format}
        </p>
      </div>

      <h1 className="text-lg font-semibold text-foreground">{t('quick.title')}</h1>

      <QuickEntryClient
        eventId={eventId}
        matchStatus={data.matchStatus}
        timeline={data.timeline}
        rosterPlayers={data.rosterPlayers}
        periods={data.periods}
        hasOfficialLineup={data.hasOfficialLineup}
      />
    </div>
  );
}
