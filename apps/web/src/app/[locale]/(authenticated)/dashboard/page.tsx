/**
 * F10.1/10.2 — Dashboard ejecutivo del club (ruta `/dashboard`).
 *
 * Gating en SERVIDOR a admin_club + coordinador (no basta con ocultar la entrada
 * en la nav): cualquier otro rol que navegue a la URL se redirige. El shell deja
 * las áreas de las secciones que llegan en 10.3–10.6 (resultados, asistencia,
 * alertas, rankings) con placeholder para no dejarlas huérfanas.
 *
 * Sección PLANTILLA (10.1 + 10.2): censo de la temporada activa (total +
 * distribución por categoría y por equipo) y **comparativa con la temporada
 * anterior** (D1: total + por categoría, con su delta). Enlaza a los listados
 * completos (/jugadores F2.10, /cuerpo-tecnico F2.11) sin duplicarlos. Si el club
 * solo tiene una temporada, se muestra el censo actual y una nota "sin anterior".
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Trophy,
  ClipboardCheck,
  TriangleAlert,
  Medal,
  ArrowRight,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import type { Role, ClubCensus } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadClubDashboardBase, loadClubResults, loadClubAttendance } from './queries';
import { AttendanceTrend } from './attendance-trend';

type Props = {
  params: Promise<{ locale: string }>;
};

/** Solo dirección ve el dashboard ejecutivo (spec 10.0 §5.0, D6). */
const DASHBOARD_ROLES: ReadonlyArray<Role> = ['admin_club', 'coordinador'];

/** Fila de la comparativa de plantilla por categoría (activa vs anterior). */
type CategoryComparisonRow = {
  categoryId: string;
  categoryName: string;
  current: number;
  /** `null` cuando no hay temporada anterior. */
  previous: number | null;
};

/**
 * Une las distribuciones por categoría de ambas temporadas por `categoryId` (las
 * categorías son plantilla permanente del club tras Rework C, así que el id es
 * estable entre temporadas). Conserva el orden de la activa y añade al final las
 * categorías que solo existieron la temporada anterior (current = 0).
 */
function buildCategoryComparison(
  current: ClubCensus,
  previous: ClubCensus | null,
): CategoryComparisonRow[] {
  const prevByCat = new Map((previous?.byCategory ?? []).map((c) => [c.categoryId, c.playerCount]));
  const seen = new Set<string>();
  const rows: CategoryComparisonRow[] = current.byCategory.map((c) => {
    seen.add(c.categoryId);
    return {
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      current: c.playerCount,
      previous: previous ? (prevByCat.get(c.categoryId) ?? 0) : null,
    };
  });
  if (previous) {
    for (const c of previous.byCategory) {
      if (seen.has(c.categoryId)) continue;
      rows.push({
        categoryId: c.categoryId,
        categoryName: c.categoryName,
        current: 0,
        previous: c.playerCount,
      });
    }
  }
  return rows;
}

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  // Gating en servidor: redirige a la home si no es dirección.
  if (!DASHBOARD_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('dashboard');
  const { season, census, previousCensus } = await loadClubDashboardBase(ctx.activeClub.club.id);
  const results = await loadClubResults(season.teamIds);
  const attendance = await loadClubAttendance(season.teamIds);

  const hasPrevious = previousCensus != null;
  const categoryRows = buildCategoryComparison(census, previousCensus);

  // Resultados por teamId, para pintar la tabla en el orden (categoría/nombre)
  // del censo. Total de "cerrados sin marcador" del club, para la nota D2.
  const resultsByTeam = new Map(results.map((r) => [r.teamId, r]));
  const closedWithoutScore = results.reduce((acc, r) => acc + r.closedWithoutScore, 0);

  // Asistencia: nombre de equipo por id (del censo activo) para etiquetar y
  // breakdown por equipo indexado por id.
  const teamNameById = new Map(census.byTeam.map((tm) => [tm.teamId, tm.teamName]));
  const attByTeam = new Map(attendance.agg.byTeam.map((tm) => [tm.teamId, tm.breakdown]));
  const clubPct = attendance.agg.club.presentPct;
  const trendPoints = attendance.agg.trendByWeek.map((p) => ({
    label: p.key,
    pct: (p.presentPct ?? 0) * 100,
    present: p.present,
    total: p.total,
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="size-6" aria-hidden />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('subtitle', {
              club: ctx.activeClub.club.name,
              season: season.activeSeason,
            })}
          </p>
        </div>
      </div>

      {/* ── Sección PLANTILLA (10.1 censo + 10.2 comparativa + enlaces) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" aria-hidden />
            {t('census.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Total + comparativa con la temporada anterior */}
          <div className="flex flex-col gap-1">
            <div className="flex items-end gap-3">
              <p className="text-4xl font-bold tabular-nums">{census.totalPlayers}</p>
              {hasPrevious && (
                <Delta current={census.totalPlayers} previous={previousCensus.totalPlayers} />
              )}
            </div>
            <p className="text-sm text-muted-foreground">{t('census.total_players')}</p>
            {hasPrevious ? (
              <p className="text-xs text-muted-foreground">
                {t('census.previous_total', {
                  season: season.previousSeason ?? '',
                  count: previousCensus.totalPlayers,
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('census.no_previous')}</p>
            )}
          </div>

          {census.byCategory.length === 0 && !hasPrevious ? (
            <p className="text-sm text-muted-foreground">{t('census.empty')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Distribución por categoría — comparativa activa vs anterior */}
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t('census.by_category')}</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('census.col.category')}</TableHead>
                      <TableHead className="text-right">{season.activeSeason}</TableHead>
                      {hasPrevious && (
                        <>
                          <TableHead className="text-right">{season.previousSeason}</TableHead>
                          <TableHead className="text-right">{t('census.col.delta')}</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryRows.map((c) => (
                      <TableRow key={c.categoryId}>
                        <TableCell className="font-medium">{c.categoryName}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.current}</TableCell>
                        {hasPrevious && (
                          <>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {c.previous ?? 0}
                            </TableCell>
                            <TableCell className="text-right">
                              <Delta current={c.current} previous={c.previous ?? 0} />
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Distribución por equipo — temporada activa (los equipos son
                  season-scoped: no se comparan entre temporadas). */}
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t('census.by_team')}</h2>
                {census.byTeam.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('census.empty')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('census.col.team')}</TableHead>
                        <TableHead>{t('census.col.category')}</TableHead>
                        <TableHead className="text-right">{t('census.col.players')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {census.byTeam.map((tm) => (
                        <TableRow key={tm.teamId}>
                          <TableCell className="font-medium">{tm.teamName}</TableCell>
                          <TableCell className="text-muted-foreground">{tm.categoryName}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {tm.playerCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}

          {/* Enlaces a los listados completos (no se duplican aquí). */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
            <Link
              href="/jugadores"
              className="inline-flex items-center gap-1.5 text-misterfc-green hover:underline"
            >
              <Users className="size-4" aria-hidden />
              {t('census.links.players')}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <Link
              href="/cuerpo-tecnico"
              className="inline-flex items-center gap-1.5 text-misterfc-green hover:underline"
            >
              <UsersRound className="size-4" aria-hidden />
              {t('census.links.staff')}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* ── Sección RESULTADOS por equipo (10.3, D2) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="size-4" aria-hidden />
            {t('results.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {census.byTeam.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('results.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('census.col.team')}</TableHead>
                  <TableHead className="text-right" title={t('results.col_full.played')}>
                    {t('results.col.played')}
                  </TableHead>
                  <TableHead className="text-right" title={t('results.col_full.wins')}>
                    {t('results.col.wins')}
                  </TableHead>
                  <TableHead className="text-right" title={t('results.col_full.draws')}>
                    {t('results.col.draws')}
                  </TableHead>
                  <TableHead className="text-right" title={t('results.col_full.losses')}>
                    {t('results.col.losses')}
                  </TableHead>
                  <TableHead className="text-right" title={t('results.col_full.goals_for')}>
                    {t('results.col.goals_for')}
                  </TableHead>
                  <TableHead className="text-right" title={t('results.col_full.goals_against')}>
                    {t('results.col.goals_against')}
                  </TableHead>
                  <TableHead className="text-right" title={t('results.col_full.goal_diff')}>
                    {t('results.col.goal_diff')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {census.byTeam.map((tm) => {
                  const r = resultsByTeam.get(tm.teamId);
                  const gd = r ? r.goalDifference : 0;
                  return (
                    <TableRow key={tm.teamId}>
                      <TableCell className="font-medium">{tm.teamName}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.played ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.wins ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.draws ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.losses ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.goalsFor ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r?.goalsAgainst ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {gd > 0 ? `+${gd}` : gd}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* D2: solo computan partidos cerrados con marcador; los demás se avisan. */}
          <p className="text-xs text-muted-foreground">
            {closedWithoutScore > 0
              ? t('results.closed_without_score', { count: closedWithoutScore })
              : t('results.only_closed_note')}
          </p>
        </CardContent>
      </Card>

      {/* ── Sección ASISTENCIA a entrenamientos (10.4) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-4" aria-hidden />
            {t('attendance.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {attendance.agg.club.total === 0 ? (
            <p className="text-sm text-muted-foreground">{t('attendance.empty')}</p>
          ) : (
            <>
              {/* Media del club */}
              <div className="flex flex-col gap-1">
                <p className="text-4xl font-bold tabular-nums">{pctLabel(clubPct)}</p>
                <p className="text-sm text-muted-foreground">
                  {t('attendance.club_avg', { sessions: attendance.agg.club.total })}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Media por equipo */}
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">{t('attendance.by_team')}</h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('census.col.team')}</TableHead>
                        <TableHead className="text-right">{t('attendance.col.sessions')}</TableHead>
                        <TableHead className="text-right">{t('attendance.col.pct')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {census.byTeam.map((tm) => {
                        const b = attByTeam.get(tm.teamId);
                        return (
                          <TableRow key={tm.teamId}>
                            <TableCell className="font-medium">{tm.teamName}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {b?.total ?? 0}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {pctLabel(b?.presentPct ?? null)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Ranking de jugadores por % presencia */}
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">{t('attendance.ranking')}</h2>
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('attendance.col.player')}</TableHead>
                          <TableHead>{t('census.col.team')}</TableHead>
                          <TableHead className="text-right">
                            {t('attendance.col.sessions')}
                          </TableHead>
                          <TableHead className="text-right">{t('attendance.col.pct')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendance.agg.playerRanking.map((p) => (
                          <TableRow key={p.playerId}>
                            <TableCell className="font-medium">
                              {attendance.playerNames[p.playerId] ?? '—'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {teamNameById.get(attendance.playerTeamId[p.playerId] ?? '') ?? '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {p.breakdown.total}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {pctLabel(p.breakdown.presentPct)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              {/* Tendencia semanal */}
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t('attendance.trend.title')}</h2>
                {trendPoints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('attendance.trend.empty')}</p>
                ) : (
                  <AttendanceTrend points={trendPoints} />
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Placeholders de las secciones que llegan en 10.5–10.6 ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PlaceholderCard
          icon={<TriangleAlert className="size-4" aria-hidden />}
          title={t('alerts.title')}
          soon={t('coming_soon')}
        />
        <PlaceholderCard
          icon={<Medal className="size-4" aria-hidden />}
          title={t('rankings.title')}
          soon={t('coming_soon')}
        />
      </div>
    </div>
  );
}

/** Formatea un % en 0..1 → "NN%" (redondeado), o "—" si es null. */
function pctLabel(p: number | null): string {
  return p == null ? '—' : `${Math.round(p * 100)}%`;
}

/**
 * Variación entre dos conteos: `+N` (verde) / `−N` (rojo) / `=` (neutro).
 * `current − previous`. El signo va también en `aria-label` para lectores.
 */
function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (diff === 0) {
    return <span className="text-xs font-medium tabular-nums text-muted-foreground">=</span>;
  }
  const up = diff > 0;
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        up ? 'text-misterfc-green' : 'text-red-500'
      }`}
    >
      {up ? '+' : '−'}
      {Math.abs(diff)}
    </span>
  );
}

function PlaceholderCard({
  icon,
  title,
  soon,
}: {
  icon: React.ReactNode;
  title: string;
  soon: string;
}) {
  return (
    <Card className="border-dashed opacity-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{soon}</CardContent>
    </Card>
  );
}
