import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { FolderKanban } from 'lucide-react';
import {
  createSupabaseServerClient,
  currentSeason,
} from '@misterfc/core';
import { Link } from '@/i18n/navigation';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CategoryDialog } from './category-dialog';
import { CategoryDeleteButton } from './category-delete-button';

type Props = {
  params: Promise<{ locale: string }>;
};

const ALLOWED_ROLES = new Set(['admin_club', 'coordinador']);

type CategoryRow = {
  id: string;
  name: string;
  season: string;
  order_idx: number;
  teams_count: number;
};

export default async function CategoriasPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!ALLOWED_ROLES.has(ctx.activeClub.role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('categorias');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: categoriesData } = await supabase
    .from('categories')
    .select('id, name, season, order_idx, teams(count)')
    .eq('club_id', ctx.activeClub.club.id)
    .order('season', { ascending: false })
    .order('order_idx', { ascending: true })
    .order('name', { ascending: true });

  // El embed `teams(count)` viene como `[{ count: N }]`.
  const categories: CategoryRow[] = (categoriesData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    season: c.season,
    order_idx: c.order_idx,
    teams_count:
      Array.isArray(c.teams) && c.teams[0] && typeof c.teams[0].count === 'number'
        ? c.teams[0].count
        : 0,
  }));

  // Agrupar por temporada
  const grouped = categories.reduce<Record<string, CategoryRow[]>>((acc, c) => {
    (acc[c.season] ??= []).push(c);
    return acc;
  }, {});
  const seasonsSorted = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const defaultSeason = currentSeason();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <CategoryDialog mode="create" defaultSeason={defaultSeason} />
      </div>

      {categories.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FolderKanban className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      )}

      {seasonsSorted.map((season) => (
        <section key={season} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {t('season_label', { season })}
          </h2>
          <Card>
            <CardHeader className="sr-only">
              <CardTitle>{t('season_label', { season })}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border p-0">
              {grouped[season]!.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between gap-2 px-4 py-3"
                >
                  <Link
                    href={`/categorias/${category.id}`}
                    className="flex flex-1 items-center gap-3 hover:opacity-90"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{category.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('teams_count', { count: category.teams_count })}
                      </span>
                    </div>
                    {category.order_idx > 0 && (
                      <Badge variant="secondary">#{category.order_idx}</Badge>
                    )}
                  </Link>
                  <div className="flex items-center gap-1">
                    <CategoryDialog
                      mode="edit"
                      defaultSeason={defaultSeason}
                      category={{
                        id: category.id,
                        name: category.name,
                        season: category.season,
                        order_idx: category.order_idx,
                      }}
                    />
                    <CategoryDeleteButton
                      categoryId={category.id}
                      categoryName={category.name}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}
