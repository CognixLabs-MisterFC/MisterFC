import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadMatchLive } from './queries';
import { LiveCaptureClient } from './_components/live-capture-client';
import { TimelineEditor } from './_components/timeline-editor';
import type { Role } from '../../../jugadores/queries';

// F7.3: la captura en vivo debe HIDRATARSE siempre desde los match_events
// persistidos (eventos, expulsiones, reloj) al entrar/recargar/volver. Forzamos
// render dinámico sin cache de ruta para que cada visita lea el estado real y no
// un RSC cacheado de una visita anterior (que reaparecería sin eventos).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
        teamName={data.event.teamName}
        opponentName={data.event.opponentName}
        format={data.event.format}
        formationCode={data.formationCode}
        fieldPlayers={data.fieldPlayers}
        hasOfficialLineup={data.hasOfficialLineup}
        matchStatus={data.matchStatus}
        periods={data.periods}
        halfDurationMinutes={data.event.halfDurationMinutes}
        recentEvents={data.recentEvents}
        benchPlayers={data.benchPlayers}
        substitutions={data.substitutions}
        absentIds={data.absentIds}
        rivalEvents={data.rivalEvents}
        regime={data.regime}
        liveFormationCode={data.liveFormationCode}
        livePositions={data.livePositions}
        formationChanges={data.formationChanges}
        starterIds={data.starterIds}
        statEvents={data.statEvents}
        shootoutKicks={data.shootoutKicks}
        teamEvents={data.teamEvents}
      />

      <TimelineEditor
        eventId={eventId}
        matchStatus={data.matchStatus}
        timeline={data.timeline}
        rosterPlayers={data.rosterPlayers}
        periods={data.periods}
        absentIds={data.absentIds}
      />
    </div>
  );
}
