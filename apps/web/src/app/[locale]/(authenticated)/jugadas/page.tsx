import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Plus, Swords } from 'lucide-react';
import { type Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  loadPlays,
  loadClubTeams,
  PLAYS_PAGE_SIZE,
  type PlayVisibility,
} from './queries';
import { PlayDeleteButton } from './_components/play-delete-button';
import { PlaysSearchInput } from './_components/plays-search-input';
import { PlayVisibilitySelect } from './_components/play-visibility-select';
// F13.5 — reusa el TeamSelect extraído en 12.3 (escribe ?team=, preserva params,
// resetea page). Su tipo ClubTeam es estructuralmente idéntico al de jugadas.
import { TeamSelect } from '../sesiones/_components/team-select';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; team?: string; visibility?: string; page?: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/** Borrar jugada = autor∪admin/coord (la RLS es el gate real; aquí solo el UI). */
const DELETE_ANY_ROLES: ReadonlyArray<Role> = ['admin_club', 'coordinador'];

// Intl no conoce 'va' (valenciano); cae a catalán para formatear fechas.
const INTL_LOCALE: Record<string, string> = { es: 'es-ES', en: 'en-GB', va: 'ca-ES' };

function normalizePage(v: string | undefined): number {
  const n = v != null ? parseInt(v, 10) : 1;
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

/**
 * F13.5 — Biblioteca de jugadas del club: búsqueda por nombre, filtro por equipo y
 * visibilidad, y paginación server-side (.range(), patrón F2.10, igual que /sesiones).
 * Solo staff. La RLS (13.1b) decide qué filas se ven; aquí solo se scopea al club.
 */
export default async function JugadasPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const clubId = ctx.activeClub.club.id;
  const t = await getTranslations('jugadas');
  const tList = await getTranslations('jugadas.list');
  const canDeleteAny = DELETE_ANY_ROLES.includes(role);

  const teams = await loadClubTeams(clubId);

  const search = (sp.q ?? '').trim();
  const teamParam = sp.team && teams.some((tm) => tm.id === sp.team) ? sp.team : null;
  const visibility: PlayVisibility | null =
    sp.visibility === 'staff' || sp.visibility === 'team' ? sp.visibility : null;
  const page = normalizePage(sp.page);

  const result = await loadPlays(clubId, { search, teamId: teamParam, visibility }, page);
  const totalPages = Math.max(1, Math.ceil(result.total / PLAYS_PAGE_SIZE));
  const hasFilters = search.length > 0 || teamParam != null || visibility != null;
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  function pageHref(p: number): string {
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    if (teamParam) q.set('team', teamParam);
    if (visibility) q.set('visibility', visibility);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/jugadas${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/jugadas/nueva">
            <Plus className="size-4" aria-hidden />
            {t('new')}
          </Link>
        </Button>
      </div>

      {/* Filtros: búsqueda + equipo + visibilidad (patrón F2.10). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <PlaysSearchInput />
        <div className="flex flex-wrap items-end gap-2">
          <TeamSelect teams={teams} current={teamParam} />
          <PlayVisibilitySelect current={visibility} />
        </div>
      </div>

      {result.plays.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Swords className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {hasFilters ? tList('empty_filtered') : tList('empty')}
            </p>
            {hasFilters ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/jugadas">{tList('clear')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.plays.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:border-foreground/30"
            >
              <Link
                href={`/jugadas/${p.id}/editar`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name ?? t('untitled')}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.team_name ?? '—'} · {tList('frame_count', { count: p.frame_count })} ·{' '}
                    {tList('updated', { date: fmt.format(new Date(p.updated_at)) })}
                  </p>
                </div>
                <Badge variant={p.visibility === 'team' ? 'default' : 'secondary'} className="shrink-0">
                  {t(`visibility.${p.visibility}`)}
                </Badge>
              </Link>
              {(canDeleteAny || p.is_owner) && (
                <PlayDeleteButton playId={p.id} playName={p.name} compact />
              )}
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
    </div>
  );
}
