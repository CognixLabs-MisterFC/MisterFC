import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CalendarDays } from 'lucide-react';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { today as todayLocal } from '@/lib/calendar-utils';
import {
  computeRange,
  loadCalendarData,
  type CalendarFilters,
} from '@/app/[locale]/(authenticated)/calendario/queries';
import { CalendarAgenda } from '@/app/[locale]/(authenticated)/calendario/_components/calendar-agenda';

type Props = { params: Promise<{ locale: string }> };

/**
 * F14C-4 — AGENDA del seguidor: REUTILIZA loadCalendarData + CalendarAgenda de
 * la pantalla de miembro, en modo SOLO-LECTURA (role 'spectator', sin equipos
 * gestionables → EventPill/EventDialog quedan read-only y sin enlaces de gestión).
 *
 * Filtrada por el equipo del NIETO ACTIVO: cambiar de nieto (selector) cambia el
 * equipo mostrado. La RLS (F14C-3, is_spectator_of_team) ya restringe los eventos
 * a los equipos seguidos; el filtro de equipo acota al nieto activo concreto.
 */
export default async function SpectatorAgendaPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadSpectatorContext();
  if (!ctx) redirect(`/${locale}/`);

  const t = await getTranslations('spectator');
  const pivot = todayLocal();
  const range = computeRange('agenda', pivot);

  const filters: CalendarFilters = {
    teamIds: ctx.activePlayer.teamId ? [ctx.activePlayer.teamId] : [],
    categoryIds: [],
    types: [],
  };

  const { events, teams, categories } = await loadCalendarData(
    ctx.activePlayer.clubId,
    range,
    filters
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <CalendarDays className="size-6" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('agenda.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('agenda.subtitle', {
              name: ctx.activePlayer.fullName,
              team: ctx.activePlayer.teamName ?? '',
            })}
          </p>
        </div>
      </div>

      <CalendarAgenda
        events={events}
        locale={locale}
        manageableTeamIds={[]}
        canManageClubEvents={false}
        teams={teams}
        categories={categories}
        role="spectator"
        canCreateSessions={false}
      />
    </div>
  );
}
