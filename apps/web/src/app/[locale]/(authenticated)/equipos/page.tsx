import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Shield, FolderCog, Users, CalendarCheck } from 'lucide-react';
import {
  TEAM_FORMATS,
  categoryKindOrdinal,
  createSupabaseServerClient,
  nextSeasonLabel,
} from '@misterfc/core';
import { Link } from '@/i18n/navigation';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TeamDialog, type Division } from './team-dialog';
import { TeamDeleteButton } from './team-delete-button';
import { SeasonFilter } from './season-filter';
import { OpenSeasonButton } from './open-season-button';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ season?: string }>;
};

const ALLOWED_ROLES = new Set(['admin_club', 'coordinador']);
const SEASON_RE = /^[0-9]{4}-[0-9]{2}$/;

export default async function EquiposPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { season: seasonParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!ALLOWED_ROLES.has(ctx.activeClub.role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('equipos');
  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Categorías-plantilla del club (selector del alta), ordenadas por kind→nombre.
  const { data: categoriesData } = await supabase
    .from('categories')
    .select('id, name, kind')
    .eq('club_id', clubId);
  const categories = (categoriesData ?? [])
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      kind: (c.kind as string | null) ?? null,
    }))
    .sort(
      (a, b) =>
        categoryKindOrdinal(a.kind) - categoryKindOrdinal(b.kind) ||
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    );

  // Catálogo de divisiones por kind (substitution_regimes).
  const { data: regimeRows } = await supabase
    .from('substitution_regimes')
    .select('category_kind, division, regime_type, max_subs, ordinal')
    .order('ordinal', { ascending: true });
  const divisionsByKind: Record<string, Division[]> = {};
  for (const r of regimeRows ?? []) {
    const kind = r.category_kind as string;
    (divisionsByKind[kind] ??= []).push({
      value: r.division as string,
      regimeType: r.regime_type as 'rolling' | 'limited',
      maxSubs: (r.max_subs as number | null) ?? null,
    });
  }

  // Rework C (C5): la temporada operativa por defecto es la ACTIVA del club
  // (seasons.status='active'), no el reloj. El selector ofrece además todas las
  // temporadas presentes en equipos (y la activa, para crear el 1er equipo).
  const clubActiveSeason = await getActiveSeasonLabel(supabase, clubId);

  // Rework C (C6): temporada en preparación (upcoming), si existe.
  const { data: upcomingRow } = await supabase
    .from('seasons')
    .select('label')
    .eq('club_id', clubId)
    .eq('status', 'upcoming')
    .maybeSingle();
  const clubUpcomingSeason = (upcomingRow?.label as string | undefined) ?? null;

  const { data: seasonRows } = await supabase
    .from('teams')
    .select('season')
    .eq('club_id', clubId);
  const seasonSet = new Set<string>([clubActiveSeason]);
  if (clubUpcomingSeason) seasonSet.add(clubUpcomingSeason);
  for (const r of seasonRows ?? []) {
    if (r.season) seasonSet.add(r.season as string);
  }
  const seasons = [...seasonSet].sort((a, b) => b.localeCompare(a));

  const isAdmin = ctx.activeClub.role === 'admin_club';

  const activeSeason =
    seasonParam && SEASON_RE.test(seasonParam) && seasonSet.has(seasonParam)
      ? seasonParam
      : clubActiveSeason;

  const viewingUpcoming =
    clubUpcomingSeason !== null && activeSeason === clubUpcomingSeason;

  // Equipos de la temporada seleccionada.
  const { data: teamsData } = await supabase
    .from('teams')
    .select('id, name, format, color, division, categories!inner(name, kind)')
    .eq('club_id', clubId)
    .eq('season', activeSeason)
    .order('name', { ascending: true });

  type TeamRow = {
    id: string;
    name: string;
    format: string;
    color: string;
    division: string | null;
    categories: { name: string; kind: string | null };
  };
  const teams = (teamsData ?? []) as unknown as TeamRow[];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('page_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/equipos/plantillas">
              <FolderCog className="size-4" aria-hidden />
              <span>{t('manage_templates')}</span>
            </Link>
          </Button>
          {/* C6: abrir temporada nueva (admin, solo si aún no hay upcoming). */}
          {isAdmin && !clubUpcomingSeason && (
            <OpenSeasonButton nextLabel={nextSeasonLabel(clubActiveSeason)} />
          )}
          {/* C8: finalizar el rollover (admin, solo si hay upcoming abierta). */}
          {isAdmin && clubUpcomingSeason && (
            <Button asChild variant="outline" size="sm">
              <Link href="/equipos/finalizar">
                <CalendarCheck className="size-4" aria-hidden />
                <span>{t('finalize.cta')}</span>
              </Link>
            </Button>
          )}
          <TeamDialog
            mode="create"
            categories={categories}
            divisionsByKind={divisionsByKind}
            defaultSeason={activeSeason}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <SeasonFilter seasons={seasons} activeSeason={activeSeason} />
      </div>

      {viewingUpcoming && (
        <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between">
          <span role="status">{t('upcoming_banner', { season: activeSeason })}</span>
          {isAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link href="/equipos/reasignacion">
                <Users className="size-4" aria-hidden />
                <span>{t('reassign.cta')}</span>
              </Link>
            </Button>
          )}
        </div>
      )}

      {categories.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FolderCog className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('no_templates')}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/equipos/plantillas">{t('manage_templates')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {categories.length > 0 && teams.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Shield className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {t('empty_season', { season: activeSeason })}
            </p>
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
                <Link
                  href={`/equipos/${team.id}`}
                  className="flex flex-1 items-center gap-3 hover:opacity-90"
                >
                  <span
                    aria-hidden
                    className="inline-block size-4 rounded-full border border-zinc-700"
                    style={{ backgroundColor: team.color }}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{team.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {team.categories.name}
                    </span>
                  </div>
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {team.format}
                  </Badge>
                </Link>
                <div className="flex items-center gap-1">
                  <TeamDialog
                    mode="edit"
                    divisionsByKind={divisionsByKind}
                    team={{
                      id: team.id,
                      name: team.name,
                      format: team.format as (typeof TEAM_FORMATS)[number],
                      color: team.color,
                      division: team.division,
                      categoryKind: team.categories.kind,
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
