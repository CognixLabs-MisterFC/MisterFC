import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { STAFF_ROLES } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadPostMatch } from './queries';
import { PostMatchClient } from './_components/post-match-client';
import type { Role } from '../../../jugadores/queries';

// Etapa terminal del ciclo. Se hidrata siempre desde el estado real (stats
// consolidadas + valoraciones guardadas) al entrar/recargar/volver.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ locale: string; eventId: string }>;
};

// Gate grueso de rol; el AUTORITATIVO es el RPC user_can_record_match (queries).

export default async function PostMatchPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) {
    redirect(`/${locale}/convocatorias/${eventId}`);
  }

  const data = await loadPostMatch(ctx.activeClub.club.id, eventId);
  if (!data) notFound();

  const t = await getTranslations('post_partido');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/convocatorias/${eventId}`}>
              <ArrowLeft className="size-4" aria-hidden />
              <span>{t('back')}</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/convocatorias/${eventId}/estadisticas`}>
              <BarChart3 className="size-4" aria-hidden />
              <span>{t('view_stats')}</span>
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {data.event.title}
          {data.event.opponentName ? ` · vs ${data.event.opponentName}` : ''}
          {' · '}
          {data.event.teamName} · {data.event.format}
        </p>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <PostMatchClient
        eventId={eventId}
        matchStatus={data.matchStatus}
        postMatchDone={data.postMatchDone}
        score={data.score}
        players={data.players}
        teamEvaluation={data.teamEvaluation}
      />
    </div>
  );
}
