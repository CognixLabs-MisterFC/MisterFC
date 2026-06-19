import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Plus, ClipboardList, Clock, BookMarked, FilePlus2 } from 'lucide-react';
import {
  type Role,
  createSupabaseServerClient,
  isIsoDate,
  mondayOfWeek,
  addDaysIso,
  weekDaysIso,
} from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SessionsSearchInput } from './_components/sessions-search-input';
import { TeamSelect } from './_components/team-select';
import { SessionDateRange } from './_components/session-date-range';
import { DeleteTemplateButton } from './_components/delete-template-button';
import {
  SESSIONS_PAGE_SIZE,
  loadSessions,
  loadSessionsWeek,
  loadClubTeams,
  loadTemplates,
} from './queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    view?: string;
    q?: string;
    team?: string;
    from?: string;
    to?: string;
    week?: string;
    page?: string;
  }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

// Intl no conoce 'va' (valenciano); cae a catalán para formatear fechas.
const INTL_LOCALE: Record<string, string> = { es: 'es-ES', en: 'en-GB', va: 'ca-ES' };

function normalizePage(v: string | undefined): number {
  const n = v != null ? parseInt(v, 10) : 1;
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

export default async function SesionesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const clubId = ctx.activeClub.club.id;
  const t = await getTranslations('sesiones');
  const tList = await getTranslations('sesiones.list');
  const tWeek = await getTranslations('sesiones.week');
  const tTabs = await getTranslations('sesiones.tabs');
  const tTpl = await getTranslations('sesiones.templates');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const [{ data: canCreate }, teams] = await Promise.all([
    supabase.rpc('user_can_create_sessions', { p_club_id: clubId }),
    loadClubTeams(clubId),
  ]);

  const view =
    sp.view === 'semana' ? 'semana' : sp.view === 'plantillas' ? 'plantillas' : 'lista';
  const teamParam = sp.team && teams.some((tm) => tm.id === sp.team) ? sp.team : null;

  // Enlaces de las pestañas (preservan el equipo seleccionado donde aplica).
  const teamQs = teamParam ? `&team=${teamParam}` : '';
  const listHref = `/sesiones${teamParam ? `?team=${teamParam}` : ''}`;
  const weekHref = `/sesiones?view=semana${teamQs}`;
  const templatesHref = '/sesiones?view=plantillas';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link href="/sesiones/nueva">
              <Plus className="size-4" aria-hidden />
              {t('new')}
            </Link>
          </Button>
        ) : null}
      </div>

      {/* Pestañas Listado / Semana */}
      <div className="flex gap-2 border-b">
        <Link
          href={listHref}
          className={cn(
            'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            view === 'lista'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {tTabs('list')}
        </Link>
        <Link
          href={weekHref}
          className={cn(
            'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            view === 'semana'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {tTabs('week')}
        </Link>
        <Link
          href={templatesHref}
          className={cn(
            'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            view === 'plantillas'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {tTabs('templates')}
        </Link>
      </div>

      {view === 'lista'
        ? await ListView({ clubId, teams, teamParam, sp, locale, tList })
        : view === 'semana'
          ? await WeekView({ clubId, teams, teamParam, weekParam: sp.week, locale, tWeek })
          : await TemplatesView({ clubId, locale, canCreate: canCreate === true, tTpl })}
    </div>
  );
}

// ── Vista LISTADO ─────────────────────────────────────────────────────────────
async function ListView({
  clubId,
  teams,
  teamParam,
  sp,
  locale,
  tList,
}: {
  clubId: string;
  teams: Awaited<ReturnType<typeof loadClubTeams>>;
  teamParam: string | null;
  sp: { q?: string; from?: string; to?: string; page?: string; team?: string };
  locale: string;
  tList: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const search = (sp.q ?? '').trim();
  const from = sp.from && isIsoDate(sp.from) ? sp.from : null;
  const to = sp.to && isIsoDate(sp.to) ? sp.to : null;
  const page = normalizePage(sp.page);

  const result = await loadSessions(clubId, { search, teamId: teamParam, from, to }, page);
  const totalPages = Math.max(1, Math.ceil(result.total / SESSIONS_PAGE_SIZE));
  const hasFilters = search.length > 0 || teamParam != null || from != null || to != null;
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  function pageHref(p: number): string {
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    if (teamParam) q.set('team', teamParam);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/sesiones${qs ? `?${qs}` : ''}`;
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <SessionsSearchInput />
        <div className="flex flex-wrap items-end gap-2">
          <TeamSelect teams={teams} current={teamParam} />
          <SessionDateRange from={from} to={to} />
        </div>
      </div>

      {result.sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ClipboardList className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {hasFilters ? tList('empty_filtered') : tList('empty')}
            </p>
            {hasFilters ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/sesiones">{tList('clear')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sesiones/${s.id}/editar`}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-foreground/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {s.title ?? tList('untitled')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.session_date ? fmt.format(new Date(`${s.session_date}T00:00:00Z`)) : '—'}
                    {s.team_name ? ` · ${s.team_name}` : ''}
                  </p>
                </div>
                {s.total_minutes != null ? (
                  <Badge variant="secondary" className="shrink-0">
                    <Clock className="mr-1 size-3" aria-hidden />
                    {tList('minutes', { count: s.total_minutes })}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {tList('page_of', { current: page, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)}>{tList('prev')}</Link>
              </Button>
            ) : null}
            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)}>{tList('next')}</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── Vista SEMANA / MICROCICLO ─────────────────────────────────────────────────
async function WeekView({
  clubId,
  teams,
  teamParam,
  weekParam,
  locale,
  tWeek,
}: {
  clubId: string;
  teams: Awaited<ReturnType<typeof loadClubTeams>>;
  teamParam: string | null;
  weekParam: string | undefined;
  locale: string;
  tWeek: Awaited<ReturnType<typeof getTranslations>>;
}) {
  // Equipo: el seleccionado o el primero de la temporada activa.
  const teamId = teamParam ?? teams[0]?.id ?? null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const monday = mondayOfWeek(weekParam && isIsoDate(weekParam) ? weekParam : todayIso);
  const days = weekDaysIso(monday);

  const rows = teamId ? await loadSessionsWeek(clubId, teamId, monday) : [];
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byDay.get(r.session_date) ?? [];
    arr.push(r);
    byDay.set(r.session_date, arr);
  }

  const dayFmt = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const rangeFmt = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'es-ES', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  function weekHref(mondayIso: string): string {
    const q = new URLSearchParams({ view: 'semana', week: mondayIso });
    if (teamParam) q.set('team', teamParam);
    return `/sesiones?${q.toString()}`;
  }

  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {tWeek('no_team')}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TeamSelect teams={teams} current={teamId} allowAll={false} />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={weekHref(addDaysIso(monday, -7))}>{tWeek('prev')}</Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            {rangeFmt.format(new Date(`${monday}T00:00:00Z`))} –{' '}
            {rangeFmt.format(new Date(`${addDaysIso(monday, 6)}T00:00:00Z`))}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={weekHref(addDaysIso(monday, 7))}>{tWeek('next')}</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const isToday = day === todayIso;
          return (
            <div
              key={day}
              className={cn(
                'flex min-h-24 flex-col gap-1.5 rounded-lg border p-2',
                isToday && 'border-primary'
              )}
            >
              <p className="text-xs font-medium capitalize text-muted-foreground">
                {dayFmt.format(new Date(`${day}T00:00:00Z`))}
              </p>
              {items.map((s) => (
                <Link
                  key={s.id}
                  href={`/sesiones/${s.id}/editar`}
                  className="rounded-md border bg-background p-1.5 text-xs transition-colors hover:border-foreground/30"
                >
                  <p className="truncate font-medium">{s.title ?? tWeek('untitled')}</p>
                  {s.total_minutes != null ? (
                    <span className="text-[10px] text-muted-foreground">
                      {tWeek('minutes', { count: s.total_minutes })}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Vista PLANTILLAS (12.6) ───────────────────────────────────────────────────
async function TemplatesView({
  clubId,
  locale,
  canCreate,
  tTpl,
}: {
  clubId: string;
  locale: string;
  canCreate: boolean;
  tTpl: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const templates = await loadTemplates(clubId);
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <BookMarked className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{tTpl('empty')}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{tTpl('empty_help')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {templates.map((tpl) => {
        const name = tpl.title ?? tTpl('untitled');
        return (
          <li
            key={tpl.id}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">
                {fmt.format(new Date(tpl.created_at))}
                {tpl.total_minutes != null ? ` · ${tTpl('minutes', { count: tpl.total_minutes })}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canCreate ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/sesiones/nueva?template=${tpl.id}`}>
                    <FilePlus2 className="size-4" aria-hidden />
                    {tTpl('use')}
                  </Link>
                </Button>
              ) : null}
              <DeleteTemplateButton templateId={tpl.id} templateName={name} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
