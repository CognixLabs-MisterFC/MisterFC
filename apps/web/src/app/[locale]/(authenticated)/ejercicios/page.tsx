import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Dumbbell, Clock, Plus } from 'lucide-react';
import { type Role, type MethodologyStatus, STAFF_ROLES, createSupabaseServerClient } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExercisesSearchInput } from './_components/exercises-search-input';
import { ExercisesFilters } from './_components/exercises-filters';
import { ExerciseImportButton } from './_components/exercise-import-button';
import { EXERCISES_PAGE_SIZE, loadExercises } from './queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    tactical?: string | string[];
    technical?: string | string[];
    category?: string | string[];
    intensity?: string | string[];
    space?: string | string[];
    phase?: string | string[];
    page?: string;
    review?: string;
  }>;
};

// Todo el staff ve la biblioteca; la RLS de 11.1 decide QUÉ filas. El jugador no.
const ALLOWED_VIEW_ROLES = STAFF_ROLES;

// Estado → variante visual del badge. La etiqueta se localiza por i18n.
const STATUS_VARIANT: Record<MethodologyStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  published: 'default',
  proposed: 'secondary',
  draft: 'outline',
  rejected: 'destructive',
};

function normalizeMulti(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((s) => s.length > 0);
}

function normalizePage(v: string | undefined): number {
  const n = v != null ? parseInt(v, 10) : 1;
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

export default async function EjerciciosPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_VIEW_ROLES.includes(role)) redirect(`/${locale}`);

  // Autoría → muestra el botón "Crear" (una sola RPC, junto a la query del listado).
  // Es defensa en profundidad para la UX: la RLS de INSERT es el gate real.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data: canCreate } = await supabase.rpc('user_can_create_exercises', {
    p_club_id: ctx.activeClub.club.id,
  });

  const t = await getTranslations('ejercicios');
  const tStatus = await getTranslations('ejercicios.status');
  const tTactical = await getTranslations('ejercicios.tactical');
  const tCategory = await getTranslations('category_kinds');

  const search = (sp.q ?? '').trim();
  const tactical = normalizeMulti(sp.tactical);
  const technical = normalizeMulti(sp.technical);
  const categories = normalizeMulti(sp.category);
  const intensity = normalizeMulti(sp.intensity);
  const spaceType = normalizeMulti(sp.space);
  const phases = normalizeMulti(sp.phase);
  const page = normalizePage(sp.page);

  // Cola de revisión (11.7): solo Admin (user_can_publish_methodology = Admin).
  const canReview = role === 'admin_club';
  const isReview = canReview && sp.review === '1';

  const result = await loadExercises(
    ctx.activeClub.club.id,
    { search, tactical, technical, categories, intensity, spaceType, phases },
    page,
    isReview
  );

  const totalPages = Math.max(1, Math.ceil(result.total / EXERCISES_PAGE_SIZE));
  const hasFilters =
    search.length > 0 ||
    tactical.length > 0 ||
    technical.length > 0 ||
    categories.length > 0 ||
    intensity.length > 0 ||
    spaceType.length > 0 ||
    phases.length > 0;

  function pageHref(p: number): string {
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    for (const v of tactical) q.append('tactical', v);
    for (const v of technical) q.append('technical', v);
    for (const v of categories) q.append('category', v);
    for (const v of intensity) q.append('intensity', v);
    for (const v of spaceType) q.append('space', v);
    for (const v of phases) q.append('phase', v);
    if (isReview) q.set('review', '1');
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/ejercicios${qs.length > 0 ? `?${qs}` : ''}`;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isReview ? t('review.title') : t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('count', { count: result.total })}
          </p>
        </div>
        {canCreate && !isReview && (
          <div className="flex flex-wrap items-center gap-2">
            <ExerciseImportButton />
            <Button asChild>
              <Link href="/ejercicios/nuevo">
                <Plus className="size-4" aria-hidden />
                {t('create')}
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Pestañas Biblioteca / Pendientes de revisión (solo Admin) */}
      {canReview && (
        <div className="flex gap-2 border-b">
          <Link
            href="/ejercicios"
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isReview
                ? 'border-transparent text-muted-foreground hover:text-foreground'
                : 'border-primary text-foreground'
            )}
          >
            {t('tabs.library')}
          </Link>
          <Link
            href="/ejercicios?review=1"
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isReview
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t('tabs.review')}
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ExercisesSearchInput />
        <ExercisesFilters
          activeTactical={tactical}
          activeTechnical={technical}
          activeCategories={categories}
          activeIntensity={intensity}
          activeSpaceType={spaceType}
          activePhases={phases}
        />
      </div>

      {result.exercises.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Dumbbell className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {hasFilters ? t('empty_filtered') : t('empty')}
            </p>
            {hasFilters && (
              <Button asChild variant="outline" size="sm">
                <Link href="/ejercicios">{t('filters.clear')}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.exercises.map((e) => (
            <Card key={e.id} className="transition-colors hover:border-foreground/30">
              {/* Enlace a la ficha (11.4 — aún no existe; placeholder navegable). */}
              <Link href={`/ejercicios/${e.id}`} className="block">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{e.name}</CardTitle>
                    <Badge variant={STATUS_VARIANT[e.status]} className="shrink-0 text-[10px] uppercase tracking-wider">
                      {tStatus(e.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {e.categories.slice(0, 3).map((c) => (
                      <Badge key={c} variant="secondary" className="text-[10px]">
                        {tCategory(c)}
                      </Badge>
                    ))}
                    {e.categories.length > 3 && (
                      <span className="text-[10px]">+{e.categories.length - 3}</span>
                    )}
                  </div>
                  {e.tactical_objectives.length > 0 && (
                    <p className="line-clamp-1">
                      {e.tactical_objectives.map((o) => tTactical(o)).join(' · ')}
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    {e.intensity && (
                      <span>{t(`intensity_values.${e.intensity}`)}</span>
                    )}
                    {e.base_duration != null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" aria-hidden />
                        {t('minutes', { count: e.base_duration })}
                      </span>
                    )}
                    {e.is_owner && (
                      <span className="text-[10px] uppercase tracking-wider text-emerald-400">
                        {t('mine')}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('pagination.page_of', { current: page, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)}>{t('pagination.prev')}</Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)}>{t('pagination.next')}</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
