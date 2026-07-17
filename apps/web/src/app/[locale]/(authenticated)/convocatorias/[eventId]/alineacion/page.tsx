import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, PenTool, Radio } from 'lucide-react';
import { STAFF_ROLES } from '@misterfc/core';
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

const MANAGER_ROLES = STAFF_ROLES;

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
        {/* F13B (fix acceso directo) — paso natural preparar once → jugar. Antes
            esta página no enlazaba al directo para NADIE; ahora sí, para todo
            partido gestionable (torneo y normal), gateado por canRecordMatch. */}
        {data.canRecordMatch && (
          <Button asChild variant="outline" size="sm" className="gap-1">
            <Link href={`/convocatorias/${eventId}/directo`}>
              <Radio className="size-4" aria-hidden />
              <span>{t('live_capture')}</span>
            </Link>
          </Button>
        )}
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {/* F13B (T-5) — deja claro que este partido pertenece a un torneo. */}
        {data.isTournamentMatch && (
          <p className="mt-1">
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
              {t('tournament_label', {
                name: data.event.title,
                round: data.event.round ?? 0,
              })}
            </span>
          </p>
        )}
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
        isTournamentMatch={data.isTournamentMatch}
        isCallupPublished={data.isCallupPublished}
      />
    </div>
  );
}
