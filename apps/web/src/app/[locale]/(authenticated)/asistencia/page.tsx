import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CalendarCheck2, ClipboardList } from 'lucide-react';
import {
  createSupabaseServerClient,
  formatPlayerName,
  type AttendanceCode,
} from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatsRangeFilter } from './_components/stats-range-filter';
import { TeamFilter } from './_components/team-filter';
import {
  loadAsistenciaStats,
  loadRecentTrainings,
  resolveAsistenciaScope,
  type StatsRange,
} from './queries';
import type { Role } from '../jugadores/queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    range?: string;
    team?: string;
  }>;
};

const ALLOWED: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'jugador',
];

// El filtro de la UI solo expone 3 presets. `custom` existe en el tipo
// `StatsRange` para soportar un futuro DateRangePicker, pero la URL
// nunca lo emite por ahora — narrow al tipo del filtro.
type StatsRangePreset = Exclude<StatsRange, 'custom'>;

function parseRange(v: string | undefined): StatsRangePreset {
  if (v === '7d' || v === '30d' || v === 'season') return v;
  return '30d';
}

function fmtShortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

export default async function AsistenciaPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('asistencia');
  const tCodes = await getTranslations('asistencia.codes');

  const range = parseRange(sp.range);

  // #7 — equipos visibles para el filtro (independiente del filtro activo, para no
  // colapsar las opciones): admin/coord → todos los del club; coach → los suyos.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const scope = await resolveAsistenciaScope(ctx.activeClub.club.id, role);
  // Bug-1: el filtro de equipo es operativo → solo la temporada activa (sin
  // duplicados del rollover).
  const activeSeason = await getActiveSeasonLabel(
    supabase,
    ctx.activeClub.club.id,
  );
  let teamOptions: Array<{ id: string; name: string }> = [];
  if (scope.kind === 'all') {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, categories!inner(club_id)')
      .eq('categories.club_id', ctx.activeClub.club.id)
      .eq('season', activeSeason);
    teamOptions = (teams ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
    }));
  } else if (scope.kind === 'restricted' && scope.teamIds.length > 0) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', scope.teamIds)
      .eq('season', activeSeason);
    teamOptions = (teams ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
    }));
  }
  teamOptions.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  // Solo aceptamos un team del filtro si está entre los visibles (no rompe scope).
  const teamId =
    sp.team && teamOptions.some((o) => o.id === sp.team) ? sp.team : undefined;

  // El filtro de equipo se muestra a admin/coord, y al coach solo si tiene varios.
  const showTeamFilter = teamOptions.length > 1;

  const [recent, stats] = await Promise.all([
    loadRecentTrainings(ctx.activeClub.club.id, role, 30, teamId),
    loadAsistenciaStats(ctx.activeClub.club.id, role, {
      range,
      teamId,
    }),
  ]);

  // Bucketea recent en "pendiente" (marked_count < roster_count) y "ok".
  const pending = recent.filter((r) => r.marked_count < r.roster_count);
  const isCoach =
    role === 'admin_club' ||
    role === 'coordinador' ||
    role === 'entrenador_principal' ||
    role === 'entrenador_ayudante';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {showTeamFilter && (
          <TeamFilter teams={teamOptions} activeTeamId={teamId ?? null} />
        )}
      </div>

      {isCoach && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-5" aria-hidden />
              {t('pending.title')}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('pending.subtitle')}
            </p>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('pending.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {pending.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <Link
                      href={`/asistencia/${r.id}`}
                      className="flex min-w-0 flex-1 flex-col hover:opacity-90"
                    >
                      <span className="truncate font-medium">{r.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {fmtShortDate(r.starts_at, locale)} · {r.team_name}
                      </span>
                    </Link>
                    <Badge variant="secondary" className="shrink-0">
                      {t('pending.count', {
                        marked: r.marked_count,
                        total: r.roster_count,
                      })}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck2 className="size-5" aria-hidden />
            {t('recent.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t('recent.empty')}
            </p>
          ) : (
            // #7 — por defecto ~10 entrenamientos visibles (más recientes primero,
            // ya ordenados en la query); el resto queda accesible con scroll (no es
            // un corte duro). max-h ≈ 10 filas + cabecera.
            <div className="max-h-[33rem] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('recent.event')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('recent.team')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('recent.when')}
                  </TableHead>
                  <TableHead>{t('recent.marked')}</TableHead>
                  <TableHead className="text-right">
                    {t('recent.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card/30 px-2 py-0.5 text-xs"
                        style={{
                          borderLeftWidth: 3,
                          borderLeftColor: r.team_color,
                        }}
                      >
                        {r.team_name}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {fmtShortDate(r.starts_at, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.marked_count === r.roster_count
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {r.marked_count}/{r.roster_count}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/asistencia/${r.id}`}>
                          {r.marked_count === r.roster_count
                            ? t('recent.open')
                            : t('recent.mark')}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{t('stats.title')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('stats.subtitle', { total: stats.totalRecorded })}
            </p>
          </div>
          <StatsRangeFilter active={range} />
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              {t('stats.by_code')}
            </h3>
            {stats.byCode.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('stats.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {stats.byCode.map((b) => (
                  <li
                    key={b.code}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>{tCodes(b.code as AttendanceCode)}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.count} · {b.pct.toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              {t('stats.by_player')}
            </h3>
            {stats.byPlayer.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('stats.empty')}
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('stats.player')}</TableHead>
                      <TableHead className="text-right">
                        {t('stats.pct')}
                      </TableHead>
                      <TableHead className="text-right">
                        {t('stats.total')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.byPlayer.map((p) => (
                      <TableRow key={p.player_id}>
                        <TableCell className="text-sm">
                          {formatPlayerName(p.first_name, p.last_name)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {p.pct_present.toFixed(0)}%
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {p.total}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
