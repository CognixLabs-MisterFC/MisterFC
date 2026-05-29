import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { UserRound, Lock } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CreatePlayerDialog } from './create-player-dialog';
import { PlayersSearchInput } from './_components/players-search-input';
import { PlayersFilters } from './_components/players-filters';
import { PlayerRowActions } from './_components/player-row-actions';
import {
  PLAYERS_PAGE_SIZE,
  loadGlobalPlayers,
  type Role,
} from './queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    year?: string | string[];
    position?: string | string[];
    team?: string | string[];
    page?: string;
  }>;
};

const ROLES_THAT_CAN_CREATE: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
];

const ALLOWED_VIEW_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

function normalizeMulti(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((s) => s.length > 0);
}

function normalizePage(v: string | undefined): number {
  const n = v != null ? parseInt(v, 10) : 1;
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const mDiff = now.getUTCMonth() - d.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

function yearOfDob(dob: string): number | null {
  if (dob.length < 4) return null;
  const y = parseInt(dob.slice(0, 4), 10);
  return Number.isNaN(y) ? null : y;
}

function initials(first: string, last: string | null): string {
  const a = first.trim().charAt(0).toUpperCase();
  const b = (last ?? '').trim().charAt(0).toUpperCase();
  return `${b || a}${a || ''}`.slice(0, 2);
}

function fullName(first: string, last: string | null): string {
  const f = first.trim();
  const l = (last ?? '').trim();
  return l.length > 0 ? `${l}, ${f}` : f;
}

export default async function JugadoresPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_VIEW_ROLES.includes(role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('jugadores');

  const search = (sp.q ?? '').trim();
  const yearStrs = normalizeMulti(sp.year);
  const years = yearStrs
    .map((y) => parseInt(y, 10))
    .filter((n) => !Number.isNaN(n));
  const positions = normalizeMulti(sp.position);
  const teamIds = normalizeMulti(sp.team);
  const page = normalizePage(sp.page);

  const result = await loadGlobalPlayers(
    ctx.activeClub.club.id,
    role,
    { search, years, positions, teamIds },
    page
  );

  const canCreate = ROLES_THAT_CAN_CREATE.includes(role);
  const canManageVisible = result.canManage;
  const teamsForDialog = result.visibleTeams.map((t) => ({
    id: t.id,
    name: t.name,
  }));

  // Estado especial: ayudante sin can_manage_squad.
  if (
    role === 'entrenador_ayudante' &&
    result.visibleTeams.length === 0 &&
    result.total === 0
  ) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Lock className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {t('forbidden_no_cap')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(result.total / PLAYERS_PAGE_SIZE));
  const hasFilters =
    search.length > 0 ||
    years.length > 0 ||
    positions.length > 0 ||
    teamIds.length > 0;

  // URL helpers para la paginación (server-side: <Link> con search params).
  function pageHref(p: number): string {
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    for (const y of years) q.append('year', String(y));
    for (const p2 of positions) q.append('position', p2);
    for (const id of teamIds) q.append('team', id);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/jugadores${qs.length > 0 ? `?${qs}` : ''}`;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('count', { count: result.total })}
          </p>
        </div>
        {canCreate && <CreatePlayerDialog teams={teamsForDialog} />}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PlayersSearchInput />
        <PlayersFilters
          teams={result.visibleTeams.map((tm) => ({
            id: tm.id,
            name: tm.name,
            category_name: tm.category_name,
          }))}
          years={result.visibleYears}
          activeYears={years}
          activePositions={positions}
          activeTeamIds={teamIds}
        />
      </div>

      {result.players.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <UserRound
              className="size-10 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              {hasFilters ? t('empty_filtered') : t('empty')}
            </p>
            {hasFilters && (
              <Button asChild variant="outline" size="sm">
                <Link href="/jugadores">{t('filters.clear')}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" aria-label={t('table.avatar')} />
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('table.year')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('table.position')}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t('table.dorsal')}
                  </TableHead>
                  <TableHead>{t('table.team')}</TableHead>
                  <TableHead className="hidden xl:table-cell">
                    {t('table.category')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('table.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.players.map((p) => {
                  const y = yearOfDob(p.date_of_birth);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <span
                          className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                          aria-hidden
                        >
                          {initials(p.first_name, p.last_name)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/jugadores/${p.id}`}
                          className="flex flex-col hover:underline"
                        >
                          <span className="font-medium">
                            {fullName(p.first_name, p.last_name)}
                          </span>
                          <span className="text-xs text-muted-foreground md:hidden">
                            {y && `${y}`}
                            {p.position_main &&
                              ` · ${t(`positions.${p.position_main}`)}`}
                          </span>
                          {p.has_account && (
                            <span className="mt-0.5 text-[10px] uppercase tracking-wider text-emerald-400">
                              {t('has_account')}
                            </span>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {y != null ? (
                          <span>
                            {y}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({t('age_years_short', { age: ageFromDob(p.date_of_birth) })})
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {p.position_main ? (
                          t(`positions.${p.position_main}`)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {p.dorsal != null ? (
                          <Badge variant="secondary">#{p.dorsal}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.current_team_name ? (
                          <span
                            className="inline-flex items-center gap-2 rounded-md border border-border bg-card/30 px-2 py-0.5 text-xs"
                            style={
                              p.current_team_color
                                ? {
                                    borderLeftWidth: 3,
                                    borderLeftColor: p.current_team_color,
                                  }
                                : undefined
                            }
                          >
                            {p.current_team_name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t('no_team')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                        {p.current_category_name ? (
                          <>
                            {p.current_category_name}
                            {p.current_category_season && (
                              <span className="ml-1">
                                · {p.current_category_season}
                              </span>
                            )}
                          </>
                        ) : (
                          <span>—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <PlayerRowActions
                          playerId={p.id}
                          hasActiveTeam={p.current_team_id != null}
                          teams={teamsForDialog}
                          canManage={canManageVisible}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('pagination.page_of', { current: page, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)}>
                  {t('pagination.prev')}
                </Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)}>
                  {t('pagination.next')}
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
