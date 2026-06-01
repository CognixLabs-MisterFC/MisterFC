import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadMatchLive } from './queries';
import { LiveCaptureClient } from './_components/live-capture-client';
import type { Role } from '../../../jugadores/queries';

type Props = {
  params: Promise<{ locale: string; eventId: string }>;
};

// Gate grueso a nivel de rol; el gate AUTORITATIVO es el RPC user_can_record_match
// de las queries (cuerpo técnico del equipo: principal o ayudante + admin/coord).
const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function MatchLivePage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) {
    redirect(`/${locale}/convocatorias/${eventId}`);
  }

  const data = await loadMatchLive(ctx.activeClub.club.id, eventId);
  if (!data) notFound();

  const t = await getTranslations('partido_directo');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/convocatorias/${eventId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          {data.event.title}
          {data.event.opponentName ? ` · vs ${data.event.opponentName}` : ''}
          {' · '}
          {data.event.teamName} · {data.event.format}
        </p>
      </div>

      <LiveCaptureClient
        eventId={eventId}
        eventType={data.event.type}
        opponentName={data.event.opponentName}
        format={data.event.format}
        formationCode={data.formationCode}
        fieldPlayers={data.fieldPlayers}
        hasOfficialLineup={data.hasOfficialLineup}
      />
    </div>
  );
}
