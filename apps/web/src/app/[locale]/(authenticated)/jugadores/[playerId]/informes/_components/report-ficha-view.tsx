/**
 * F13.10 — Cuerpo de la FICHA del informe (read-only), COMPARTIDO por la vista
 * staff ([period]) y la vista familia (/mi-ficha). Recibe los datos ya cargados y
 * pinta: cabecera (foto + dorsal + edad/pie/posición + mini-campo) + stats de
 * temporada + resumen (media global + estado) + radar + grupos coloreados +
 * comentario + objetivos con color + evolución + bloque de equipo. Sin controles
 * de edición/publicación (esos los añade la página staff por fuera).
 */

import { getTranslations } from 'next-intl/server';
import {
  reportStatus,
  computeGroupAverages,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  type PlayerPosition,
} from '@misterfc/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { scoreClasses, formatScore } from '@/lib/score-color';
import { ScoreGrid } from './score-grid';
import { FichaHeader } from './ficha-header';
import { GroupRadarChart, EvolutionChart } from './report-charts';
import type { FichaStats, PeriodAverages, ObjectiveRow } from '../queries';

const OBJ_STATUS_CLASS: Record<string, string> = {
  open: 'bg-muted text-muted-foreground border-border',
  achieved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  dropped: 'bg-red-500/10 text-red-300/80 border-red-500/20 line-through',
};

export type ReportFichaData = {
  fullName: string;
  initials: string;
  photoUrl: string | null;
  dorsal: number | null;
  age: number | null;
  primaryPos: PlayerPosition | null;
  secondaryPos: string[];
  foot: string | null;
  teamName: string;
  seasonLabel: string;
  period: string;
  stats: FichaStats;
  scores: Record<string, number>;
  commentOverall: string | null;
  teamReport: { scores: Record<string, number>; comment: string | null } | null;
  playerObjectives: ObjectiveRow[];
  teamObjectives: ObjectiveRow[];
  evolution: PeriodAverages[];
};

export async function ReportFichaView({ data }: { data: ReportFichaData }) {
  const t = await getTranslations('informes');

  const { perGroup, overall } = computeGroupAverages(DEVELOPMENT_REPORT_CATALOG, data.scores);
  const status = reportStatus(data.scores, DEVELOPMENT_REPORT_CATALOG);

  const statCards: Array<{ key: string; value: string }> = [
    { key: 'matches', value: String(data.stats.matches) },
    { key: 'minutes', value: String(data.stats.minutes) },
    { key: 'goals', value: String(data.stats.goals) },
    { key: 'assists', value: String(data.stats.assists) },
    { key: 'cards', value: String(data.stats.yellow + data.stats.red) },
    {
      key: 'attendance',
      value:
        data.stats.attendancePresentPct == null
          ? '—'
          : `${Math.round(data.stats.attendancePresentPct * 100)}%`,
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
  const evolutionData = data.evolution.map((e) => ({ ...e, period: t(`period_short.${e.period}`) }));
  const evolutionHasData = data.evolution.some(
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
    <div className="flex flex-col gap-6">
      {/* ── CABECERA ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <FichaHeader
            data={{
              fullName: data.fullName,
              initials: data.initials,
              photoUrl: data.photoUrl,
              dorsal: data.dorsal,
              age: data.age,
              primaryPos: data.primaryPos,
              secondaryPos: data.secondaryPos,
              foot: data.foot,
              subtitle: `${data.teamName} · ${data.seasonLabel} · ${t(`period.${data.period}`)}`,
            }}
          />

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

      {/* ── GRUPOS ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('individual_report')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScoreGrid catalog={DEVELOPMENT_REPORT_CATALOG} initial={data.scores} readOnly />
          {data.commentOverall ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('comment_overall')}</span>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.commentOverall}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── OBJETIVOS INDIVIDUALES ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('objectives_individual')}</CardTitle>
        </CardHeader>
        <CardContent>{renderObjectives(data.playerObjectives)}</CardContent>
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

      {/* ── BLOQUE DE EQUIPO ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('team_block_title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.teamReport ? (
            <>
              <ScoreGrid catalog={TEAM_REPORT_CATALOG} initial={data.teamReport.scores} readOnly />
              {data.teamReport.comment ? (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{t('team_comment')}</span>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {data.teamReport.comment}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('objectives_team')}</span>
                {renderObjectives(data.teamObjectives)}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('team_block_missing')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
