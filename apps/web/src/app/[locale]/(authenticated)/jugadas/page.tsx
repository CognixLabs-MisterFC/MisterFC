import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Plus, Swords } from 'lucide-react';
import {
  type Role,
  type MethodologyStatus,
  STAFF_ROLES,
  ADMIN_ROLES,
} from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { loadPlays, PLAYS_PAGE_SIZE, type PlayStatusFilter } from './queries';
import { PlayDeleteButton } from './_components/play-delete-button';
import { PlaysSearchInput } from './_components/plays-search-input';
import { PlayStatusSelect } from './_components/play-status-select';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string; review?: string }>;
};

/** Aprobar/revisar/archivar = admin∪coordinador (= user_can_approve_plays, D1). */
const APPROVER_ROLES: ReadonlyArray<Role> = ADMIN_ROLES;

// Estado → variante visual del badge (la etiqueta se localiza por i18n).
const STATUS_VARIANT: Record<MethodologyStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  published: 'default',
  proposed: 'secondary',
  draft: 'outline',
  rejected: 'destructive',
};

const STATUS_VALUES: ReadonlyArray<PlayStatusFilter> = [
  'draft',
  'proposed',
  'published',
  'rejected',
  'archived',
];

// Intl no conoce 'va' (valenciano); cae a catalán para formatear fechas.
const INTL_LOCALE: Record<string, string> = { es: 'es-ES', en: 'en-GB', va: 'ca-ES' };

function normalizePage(v: string | undefined): number {
  const n = v != null ? parseInt(v, 10) : 1;
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

/**
 * JR-1 (ADR-0019) — Banco de jugadas del club con ciclo: búsqueda por nombre,
 * filtro por estado y paginación server-side (.range(), patrón F2.10). El aprobador
 * (admin/coord) tiene además una pestaña "Pendientes de revisión". Solo staff; la
 * RLS por estado (JR-0) decide qué filas se ven; aquí solo se scopea al club.
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
  const tStatus = await getTranslations('jugadas.status');

  const canReview = APPROVER_ROLES.includes(role);
  const isReview = canReview && sp.review === '1';

  const search = (sp.q ?? '').trim();
  const status: PlayStatusFilter | null =
    sp.status != null && STATUS_VALUES.includes(sp.status as PlayStatusFilter)
      ? (sp.status as PlayStatusFilter)
      : null;
  const page = normalizePage(sp.page);

  const result = await loadPlays(clubId, { search, status }, page, isReview);
  const totalPages = Math.max(1, Math.ceil(result.total / PLAYS_PAGE_SIZE));
  const hasFilters = search.length > 0 || status != null;
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  function pageHref(p: number): string {
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    if (status) q.set('status', status);
    if (isReview) q.set('review', '1');
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/jugadas${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isReview ? t('review.title') : t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {!isReview && (
          <Button asChild>
            <Link href="/jugadas/nueva">
              <Plus className="size-4" aria-hidden />
              {t('new')}
            </Link>
          </Button>
        )}
      </div>

      {/* Pestañas Biblioteca / Pendientes de revisión (solo aprobador). */}
      {canReview && (
        <div className="flex gap-2 border-b">
          <Link
            href="/jugadas"
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isReview
                ? 'border-transparent text-muted-foreground hover:text-foreground'
                : 'border-primary text-foreground',
            )}
          >
            {t('tabs.library')}
          </Link>
          <Link
            href="/jugadas?review=1"
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isReview
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t('tabs.review')}
          </Link>
        </div>
      )}

      {/* Filtros: búsqueda + estado (en revisión, solo búsqueda: ya son propuestas). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <PlaysSearchInput />
        {!isReview && (
          <div className="flex flex-wrap items-end gap-2">
            <PlayStatusSelect current={status} />
          </div>
        )}
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
                    {tList('frame_count', { count: p.frame_count })} ·{' '}
                    {tList('updated', { date: fmt.format(new Date(p.updated_at)) })}
                  </p>
                </div>
                <Badge
                  variant={p.archived ? 'outline' : STATUS_VARIANT[p.status]}
                  className="shrink-0 text-[10px] uppercase tracking-wider"
                >
                  {p.archived ? tStatus('archived') : tStatus(p.status)}
                </Badge>
              </Link>
              {p.status !== 'published' && (canReview || p.is_owner) && (
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
