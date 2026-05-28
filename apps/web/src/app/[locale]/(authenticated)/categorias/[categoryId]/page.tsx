import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  TEAM_FORMATS,
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
import { TeamDialog } from './team-dialog';
import { TeamDeleteButton } from './team-delete-button';

type Props = {
  params: Promise<{ locale: string; categoryId: string }>;
};

const ALLOWED_ROLES = new Set(['admin_club', 'coordinador']);

export default async function CategoryDetailPage({ params }: Props) {
  const { locale, categoryId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!ALLOWED_ROLES.has(ctx.activeClub.role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('equipos');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: category } = await supabase
    .from('categories')
    .select('id, name, season, club_id')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) notFound();
  if (category.club_id !== ctx.activeClub.club.id) notFound();

  const { data: teamsData } = await supabase
    .from('teams')
    .select('id, name, format, color')
    .eq('category_id', categoryId)
    .order('name', { ascending: true });

  const teams = teamsData ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/categorias"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:underline"
        >
          {t('back_to_categorias')}
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('subtitle', { season: category.season })}
            </p>
          </div>
          <TeamDialog mode="create" categoryId={categoryId} />
        </div>
      </div>

      {teams.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      )}

      {teams.length > 0 && (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('list_title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {teams.map((team) => (
              <div
                key={team.id}
                className="flex items-center justify-between gap-2 px-4 py-3"
              >
                <div className="flex flex-1 items-center gap-3">
                  <span
                    aria-hidden
                    className="inline-block size-4 rounded-full border border-zinc-700"
                    style={{ backgroundColor: team.color }}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{team.name}</span>
                    <Badge variant="secondary" className="mt-0.5 w-fit text-xs">
                      {team.format}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <TeamDialog
                    mode="edit"
                    categoryId={categoryId}
                    team={{
                      id: team.id,
                      name: team.name,
                      format: team.format as (typeof TEAM_FORMATS)[number],
                      color: team.color,
                    }}
                  />
                  <TeamDeleteButton teamId={team.id} teamName={team.name} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
