/**
 * F13.10 — FICHA (vista de solo-lectura) del informe individual de un periodo:
 * cabecera (datos + mini-campo + stats de temporada) + resumen global + radar de
 * las 4 medias + grupos coloreados + bloque de equipo + objetivos con color +
 * evolución multi-periodo. El editor vive en [period]/editar. Gate D13.
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Pencil } from 'lucide-react';
import {
  createSupabaseServerClient,
  isDevelopmentPeriod,
  reportStatus,
  computeGroupAverages,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  PLAYER_POSITIONS,
  type PlayerPosition,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { scoreClasses, formatScore } from '@/lib/score-color';
import {
  loadClubSeasons,
  resolvePlayerTeamForSeason,
  loadIndividualReport,
  loadTeamReport,
  loadPlayerObjectives,
  loadTeamObjectives,
  loadFichaStats,
  loadPlayerEvolution,
  type ObjectiveRow,
} from '../queries';
import { ScoreGrid } from '../_components/score-grid';
import { PositionField } from '../_components/position-field';
import { GroupRadarChart, EvolutionChart } from '../_components/report-charts';
import { PublishToggle } from '../_components/publish-toggle';

type Props = {
  params: Promise<{ locale: string; playerId: string; period: string }>;
  searchParams: Promise<{ season?: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

const PHOTO_TTL = 3600;

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

const OBJ_STATUS_CLASS: Record<string, string> = {
  open: 'bg-muted text-muted-foreground border-border',
  achieved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  dropped: 'bg-red-500/10 text-red-300/80 border-red-500/20 line-through',
};

export default async function InformeFichaPage({ params, searchParams }: Props) {
  const { locale, playerId, period } = await params;
  const { season: seasonParam } = await searchParams;
  setRequestLocale(locale);

  if (!isDevelopmentPeriod(period)) notFound();

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!STAFF_ROLES.includes(ctx.activeClub.role as Role)) redirect(`/${locale}`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  const { data: player } = await supabase
    .from('players')
    .select(
      'id, club_id, first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, photo_url',
    )
    .eq('id', playerId)
    .maybeSingle();
  if (!player || player.club_id !== clubId) notFound();

  const t = await getTranslations('informes');
  const tPos = await getTranslations('jugadores.positions');
  const tFoot = await getTranslations('jugadores.foot_options');

  const seasons = await loadClubSeasons(supabase, clubId);
  const activeLabel = await getActiveSeasonLabel(supabase, clubId);
  const selectedLabel =
    seasonParam && seasons.some((s) => s.label === seasonParam) ? seasonParam : activeLabel;
  const selectedSeason = seasons.find((s) => s.label === selectedLabel) ?? null;
  const team = await resolvePlayerTeamForSeason(supabase, playerId, selectedLabel);
  const seasonId = selectedSeason?.id ?? null;

  const seasonQs = `?season=${encodeURIComponent(selectedLabel)}`;
  const backHref = `/jugadores/${playerId}/informes${seasonQs}`;
  const editHref = `/jugadores/${playerId}/informes/${period}/editar${seasonQs}`;
  const fullName = `${player.first_name} ${player.last_name ?? ''}`.trim();

  let photoUrl: string | null = null;
  if (player.photo_url) {
    const { data } = await supabase.storage
      .from('player-photos')
      .createSignedUrl(player.photo_url, PHOTO_TTL);
    photoUrl = data?.signedUrl ?? null;
  }

  const report =
    team && seasonId ? await loadIndividualReport(supabase, playerId, seasonId, period) : null;
  const teamReport =
    team && seasonId ? await loadTeamReport(supabase, team.teamId, seasonId, period) : null;
  const teamObjectives =
    team && seasonId ? await loadTeamObjectives(supabase, team.teamId, seasonId) : [];
  const playerObjectives =
    seasonId ? await loadPlayerObjectives(supabase, playerId, seasonId) : [];
  const stats = await loadFichaStats(supabase, playerId, selectedLabel);
  const evolution = seasonId ? await loadPlayerEvolution(supabase, playerId, seasonId) : [];

  const scores = report?.scores ?? {};
  const { perGroup, overall } = computeGroupAverages(DEVELOPMENT_REPORT_CATALOG, scores);
  const status = reportStatus(scores, DEVELOPMENT_REPORT_CATALOG);

  const age = ageFromDob(player.date_of_birth);
  const primaryPos = (PLAYER_POSITIONS as readonly string[]).includes(player.position_main ?? '')
    ? (player.position_main as PlayerPosition)
    : null;
  const secondaryPos = (player.positions_secondary ?? []) as string[];

  const statCards: Array<{ key: string; value: string }> = [
    { key: 'matches', value: String(stats.matches) },
    { key: 'minutes', value: String(stats.minutes) },
    { key: 'goals', value: String(stats.goals) },
    { key: 'assists', value: String(stats.assists) },
    { key: 'cards', value: String(stats.yellow + stats.red) },
    {
      key: 'attendance',
      value:
        stats.attendancePresentPct == null
          ? '—'
          : `${Math.round(stats.attendancePresentPct * 100)}%`,
    },
  ];

  const radarData = DEVELOPMENT_REPORT_CATALOG.groups.map((g) => ({
    group: t(`cat_group.${g.id}`),
    value: perGroup[g.id] ?? 0,
  }));

  const groupLabels: Record<string, string> = {
    tecnico: t('cat_group.tecnico'),
    tactico: t('cat_group.tactico'),
    fisico: t('cat_group.fisico'),
    actitud: t('cat_group.actitud'),
  };
  const evolutionData = evolution.map((e) => ({
    ...e,
    period: t(`period_short.${e.period}`),
  }));
  const evolutionHasData = evolution.some(
    (e) => e.tecnico != null || e.tactico != null || e.fisico != null || e.actitud != null,
  );

  const renderObjectives = (items: ObjectiveRow[]) =>
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('no_objectives')}</p>
    ) : (
      <ul className="flex flex-col gap-1.5">
        {items.map((o) => (
          <li
            key={o.id}
            className={cn(
              'flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm',
              OBJ_STATUS_CLASS[o.status] ?? OBJ_STATUS_CLASS.open,
            )}
          >
            <span>{o.title}</span>
            <span className="shrink-0 text-xs font-medium">{t(`status.${o.status}`)}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_reports')}</span>
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {report ? (
            <PublishToggle
              reportId={report.id}
              playerId={playerId}
              period={period}
              locale={locale}
              initialVisibility={report.visibility}
            />
          ) : null}
          <Button asChild size="sm">
            <Link href={editHref}>
              <Pencil className="size-4" aria-hidden />
              <span>{t('edit_report')}</span>
            </Link>
          </Button>
        </div>
      </div>

      {!team || !seasonId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team_for_season')}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── CABECERA ───────────────────────────────────────────────── */}
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <div className="flex flex-wrap items-start gap-4">
                <Avatar className="size-20 border border-border">
                  {photoUrl ? <AvatarImage src={photoUrl} alt={fullName} /> : null}
                  <AvatarFallback className="text-lg">
                    {(player.first_name[0] ?? '') + (player.last_name?.[0] ?? '')}
                  </AvatarFallback>
                </Avatar>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold tracking-tight">{fullName}</h1>
                    {player.dorsal != null ? (
                      <span className="rounded-md bg-misterfc-green/15 px-2 py-0.5 text-sm font-semibold text-misterfc-green">
                        #{player.dorsal}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {team.teamName} · {selectedLabel} · {t(`period.${period}`)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {age != null ? <span>{t('age', { age })}</span> : null}
                    {primaryPos ? <span>{tPos(primaryPos)}</span> : null}
                    {player.foot ? <span>{tFoot(player.foot)}</span> : null}
                  </div>
                </div>

                <PositionField primary={primaryPos} secondary={secondaryPos} />
              </div>

              {/* STATS de temporada */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {statCards.map((c) => (
                  <div
                    key={c.key}
                    className="flex flex-col gap-0.5 rounded-lg border border-border bg-card/40 p-3 text-center"
                  >
                    <span className="text-xl font-bold tabular-nums">{c.value}</span>
                    <span className="text-[11px] text-muted-foreground">{t(`ficha.stat.${c.key}`)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── RESUMEN + RADAR ─────────────────────────────────────────── */}
          <Card>
            <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
              <div className="flex flex-col justify-center gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{t('overall_average')}</span>
                  <span
                    className={cn(
                      'inline-flex min-w-14 justify-center rounded-lg border px-3 py-1.5 text-2xl font-bold tabular-nums',
                      scoreClasses(overall),
                    )}
                  >
                    {formatScore(overall)}
                  </span>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">{t('status_label')}: </span>
                  <span className="font-medium">{t(`report_status.${status}`)}</span>
                </p>
              </div>
              <div>
                <GroupRadarChart data={radarData} />
              </div>
            </CardContent>
          </Card>

          {/* ── GRUPOS (coloreados) ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('individual_report')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ScoreGrid catalog={DEVELOPMENT_REPORT_CATALOG} initial={scores} readOnly />
              {report?.comment_overall ? (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{t('comment_overall')}</span>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {report.comment_overall}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ── OBJETIVOS INDIVIDUALES (con color) ──────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('objectives_individual')}</CardTitle>
            </CardHeader>
            <CardContent>{renderObjectives(playerObjectives)}</CardContent>
          </Card>

          {/* ── EVOLUCIÓN MULTI-PERIODO ─────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('evolution_title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {evolutionHasData ? (
                <EvolutionChart data={evolutionData} labels={groupLabels} />
              ) : (
                <p className="text-sm text-muted-foreground">{t('evolution_empty')}</p>
              )}
            </CardContent>
          </Card>

          {/* ── BLOQUE DE EQUIPO (coloreado, fijo) ──────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('team_block_title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {teamReport ? (
                <>
                  <ScoreGrid catalog={TEAM_REPORT_CATALOG} initial={teamReport.scores} readOnly />
                  {teamReport.comment ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">{t('team_comment')}</span>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {teamReport.comment}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t('objectives_team')}</span>
                    {renderObjectives(teamObjectives)}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('team_block_missing')}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
