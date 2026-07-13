import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { loadShellContext } from '@/lib/auth-shell';
import {
  parseIsoDate,
  today as todayLocal,
  toIsoDate,
} from '@/lib/calendar-utils';
import { CalendarHeader } from './_components/calendar-header';
import { CalendarFilters } from './_components/calendar-filters';
import { CalendarMonth } from './_components/calendar-month';
import { CalendarWeek } from './_components/calendar-week';
import { CalendarAgenda } from './_components/calendar-agenda';
import { EventDialog } from './_components/event-dialog';
import {
  computeRange,
  loadCalendarData,
  loadCalendarScopeTeamIds,
  loadManageableTeams,
  loadCanCreateSessions,
  type CalendarFilters as Filters,
} from './queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    view?: string;
    date?: string;
    team?: string | string[];
    category?: string | string[];
    type?: string | string[];
  }>;
};

function normalizeMulti(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeView(v: string | undefined): 'month' | 'week' | 'agenda' {
  if (v === 'week' || v === 'agenda') return v;
  return 'month';
}

export default async function CalendarioPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const view = normalizeView(sp.view);
  const parsedPivot = sp.date ? parseIsoDate(sp.date) : null;
  const pivot = parsedPivot ?? todayLocal();

  const filters: Filters = {
    teamIds: normalizeMulti(sp.team),
    categoryIds: normalizeMulti(sp.category),
    types: normalizeMulti(sp.type),
  };

  const range = computeRange(view, pivot);
  const t = await getTranslations('calendario');

  // FIX-DIRECTO — la agenda se acota a los equipos del usuario (null = admin/coord
  // → club-wide). Evita que los partidos, ahora club-wide en la RLS por el directo,
  // se cuelen en el calendario de un jugador/padre/entrenador.
  const scopeTeamIds = await loadCalendarScopeTeamIds(
    ctx.activeClub.club.id,
    ctx.activeClub.role
  );

  const { events, teams, categories } = await loadCalendarData(
    ctx.activeClub.club.id,
    range,
    filters,
    { scopeTeamIds }
  );

  const { manageableTeamIds, canManageClubEvents } =
    await loadManageableTeams(ctx.activeClub.club.id, ctx.activeClub.role, teams);

  const canCreateAny =
    canManageClubEvents || manageableTeamIds.length > 0;

  // 12.8a — ¿puede planificar sesiones? (botón "Planificar sesión" en eventos
  // training de equipo). Capacidad distinta de gestionar el calendario.
  const canCreateSessions = await loadCanCreateSessions(ctx.activeClub.club.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarFilters
            teams={teams}
            categories={categories}
            activeTeamIds={filters.teamIds}
            activeCategoryIds={filters.categoryIds}
            activeTypes={filters.types}
          />
          {canCreateAny && (
            <EventDialog
              mode="new"
              defaultDateIso={toIsoDate(pivot)}
              locale={locale}
              canManage
              manageableTeamIds={manageableTeamIds}
              canManageClubEvents={canManageClubEvents}
              teams={teams}
              categories={categories}
            />
          )}
        </div>
      </div>

      <CalendarHeader view={view} pivot={pivot} locale={locale} />

      {view === 'month' && (
        <CalendarMonth
          pivot={pivot}
          events={events}
          locale={locale}
          manageableTeamIds={manageableTeamIds}
          canManageClubEvents={canManageClubEvents}
          teams={teams}
          categories={categories}
          role={ctx.activeClub.role}
          canCreateSessions={canCreateSessions}
        />
      )}
      {view === 'week' && (
        <CalendarWeek
          pivot={pivot}
          events={events}
          locale={locale}
          manageableTeamIds={manageableTeamIds}
          canManageClubEvents={canManageClubEvents}
          teams={teams}
          categories={categories}
          role={ctx.activeClub.role}
          canCreateSessions={canCreateSessions}
        />
      )}
      {view === 'agenda' && (
        <CalendarAgenda
          events={events}
          locale={locale}
          manageableTeamIds={manageableTeamIds}
          canManageClubEvents={canManageClubEvents}
          teams={teams}
          categories={categories}
          role={ctx.activeClub.role}
          canCreateSessions={canCreateSessions}
        />
      )}
    </div>
  );
}
