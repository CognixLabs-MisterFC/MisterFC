import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { FolderCog } from 'lucide-react';
import {
  categoryKindOrdinal,
  createSupabaseServerClient,
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

export default async function PlantillasPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!ALLOWED_ROLES.has(ctx.activeClub.role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('plantillas');
  const tk = await getTranslations('category_kinds');
  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: categoriesData } = await supabase
    .from('categories')
    .select('id, name, kind, half_duration_minutes, teams(count)')
    .eq('club_id', clubId);

  type Row = {
    id: string;
    name: string;
    kind: string | null;
    half_duration_minutes: number;
    teams_count: number;
  };
  // Orden derivado de kind (🔒 O1): ordinal del kind, NULL al final; desempate por
  // nombre (collation es, case-insensitive).
  const categories: Row[] = (categoriesData ?? [])
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      kind: (c.kind as string | null) ?? null,
      half_duration_minutes: (c.half_duration_minutes as number | null) ?? 45,
      teams_count:
        Array.isArray(c.teams) && c.teams[0] && typeof c.teams[0].count === 'number'
          ? c.teams[0].count
          : 0,
    }))
    .sort(
      (a, b) =>
        categoryKindOrdinal(a.kind) - categoryKindOrdinal(b.kind) ||
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/equipos"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:underline"
        >
          {t('back_to_equipos')}
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <CategoryDialog mode="create" />
        </div>
      </div>

      {categories.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FolderCog className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      )}

      {categories.length > 0 && (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between gap-2 px-4 py-3"
              >
                <div className="flex flex-1 items-center gap-3">
                  <div className="flex flex-col">
                    <span className="font-medium">{category.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('teams_count', { count: category.teams_count })} ·{' '}
                      {t('half_short', { min: category.half_duration_minutes })}
                    </span>
                  </div>
                  {category.kind && (
                    <Badge variant="secondary">{tk(category.kind)}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <CategoryDialog
                    mode="edit"
                    category={{
                      id: category.id,
                      name: category.name,
                      kind: category.kind,
                      half_duration_minutes: category.half_duration_minutes,
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
      )}
    </div>
  );
}
