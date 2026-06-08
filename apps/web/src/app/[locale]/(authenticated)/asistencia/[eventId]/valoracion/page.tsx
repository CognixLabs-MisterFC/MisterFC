import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadTrainingEvaluation } from './queries';
import { TrainingEvalClient } from './_components/training-eval-client';
import type { Role } from '../../../jugadores/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ locale: string; eventId: string }>;
};

// Gate grueso de rol; el AUTORITATIVO es el RPC user_can_record_match (queries).
const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function TrainingEvaluationPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) {
    redirect(`/${locale}/asistencia/${eventId}`);
  }

  const data = await loadTrainingEvaluation(ctx.activeClub.club.id, eventId);
  if (!data) notFound();

  const t = await getTranslations('valoracion_entreno');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/asistencia/${eventId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          {data.event.title}
          {' · '}
          {data.event.teamName}
        </p>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <TrainingEvalClient eventId={eventId} players={data.players} />
    </div>
  );
}
