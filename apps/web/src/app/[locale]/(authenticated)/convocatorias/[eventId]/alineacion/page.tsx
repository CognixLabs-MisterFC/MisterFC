import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, PenTool } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadLineupEditor } from './queries';
import { LineupEditorClient } from './_components/lineup-editor-client';
import type { Role } from '../../../jugadores/queries';

type Props = {
  params: Promise<{ locale: string; eventId: string }>;
  searchParams: Promise<{ lineup?: string }>;
};

const MANAGER_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function LineupPage({ params, searchParams }: Props) {
  const { locale, eventId } = await params;
  const { lineup } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  // Jugadores/familias no editan alineaciones → a la convocatoria.
  if (!MANAGER_ROLES.includes(role)) {
    redirect(`/${locale}/convocatorias/${eventId}`);
  }

  const data = await loadLineupEditor(
    ctx.activeClub.club.id,
    eventId,
    lineup ?? null,
  );
  if (!data) notFound();

  const t = await getTranslations('alineacion');
  const tPizarra = await getTranslations('pizarra');
  const selected = data.lineups.find((l) => l.id === data.selectedLineupId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/convocatorias/${eventId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
        {/* F11B.2 — abrir la pizarra táctica sobre el once de este partido. */}
        <Button asChild variant="outline" size="sm" className="ml-auto gap-1">
          <Link href={`/pizarra?event=${eventId}`}>
            <PenTool className="size-4" aria-hidden />
            <span>{tPizarra('open_board')}</span>
          </Link>
        </Button>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {data.event.title}
          {data.event.opponentName ? ` · vs ${data.event.opponentName}` : ''}
          {' · '}
          {data.event.teamName} · {data.event.format}
        </p>
      </header>

      <LineupEditorClient
        key={data.selectedLineupId ?? 'new'}
        eventId={eventId}
        format={data.event.format}
        roster={data.roster}
        discarded={data.discarded}
        lineups={data.lineups}
        selectedLineupId={data.selectedLineupId}
        selectedFormationCode={selected?.formationCode ?? null}
        selectedIsOfficial={selected?.isOfficial ?? false}
        selectedVisibility={selected?.visibility ?? 'staff'}
        initialPositions={data.positions}
        initialTacticalNotes={data.tacticalNotes}
        initialPlannedSubs={data.plannedSubs}
        coachFormations={data.coachFormations}
      />
    </div>
  );
}
