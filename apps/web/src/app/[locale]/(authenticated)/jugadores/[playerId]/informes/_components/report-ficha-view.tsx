/**
 * F13.10 — Cuerpo de la FICHA del informe (read-only), COMPARTIDO por la vista
 * staff ([period]) y la vista familia (/mi-ficha). Sin controles de edición.
 *
 * F13.10h-2 — Orden de secciones (definido por el usuario):
 *  1. Datos del jugador (cabecera + stats).
 *  2. Puntuación y gráfico (media global + radar).
 *  3. Objetivos (individuales + grupales): estado DERIVADO (objectiveDisplayState)
 *     + sus dos comentarios etiquetados (proyección = description, revisión =
 *     review_comment), color por estado.
 *  4. Evolución individual (gráfico existente).
 *  5. Evolución de equipo (hueco reservado; lo completa un trozo posterior).
 *  6. Resultados individuales (4 grupos con color).
 *  7. Resultados de equipo (3 grupos con color).
 */

import { getTranslations, getLocale } from 'next-intl/server';
import { ArrowUpCircle } from 'lucide-react';
import {
  reportStatus,
  computeGroupAverages,
  objectiveDisplayState,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  type PlayerPosition,
} from '@misterfc/core';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { scoreClasses, formatScore } from '@/lib/score-color';
import { OBJ_STATE_CLASS } from '@/lib/objective-display';
import { ScoreGrid } from './score-grid';
import { FichaHeader } from './ficha-header';
import { GroupRadarChart, EvolutionChart } from './report-charts';
import type { FichaStats, PeriodAverages, TeamPeriodAverages, ObjectiveRow } from '../queries';

/** Series (clave de grupo → color) del gráfico de evolución individual y de equipo. */
const INDIV_EVOLUTION_SERIES = [
  { key: 'tecnico', color: '#34d399' },
  { key: 'tactico', color: '#60a5fa' },
  { key: 'fisico', color: '#fbbf24' },
  { key: 'actitud', color: '#c084fc' },
];
const TEAM_EVOLUTION_SERIES = [
  { key: 'rendimiento_colectivo', color: '#34d399' },
  { key: 'dinamica_grupo', color: '#60a5fa' },
  { key: 'evolucion_equipo', color: '#fbbf24' },
];

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
  teamEvolution: TeamPeriodAverages[];
};

export async function ReportFichaView({ data }: { data: ReportFichaData }) {
  const t = await getTranslations('informes');
  const locale = await getLocale();

  // D3 — formateo de fecha de las subidas (fecha corta + hora, TZ del proyecto).
  const fmtPromoDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Madrid',
    }).format(new Date(iso));

  const { perGroup, overall } = computeGroupAverages(DEVELOPMENT_REPORT_CATALOG, data.scores);
  const status = reportStatus(data.scores, DEVELOPMENT_REPORT_CATALOG);

  // F13.10h-4 — ratio "num/den"; '—' si no hay denominador (sin equipo/eventos).
  const ratio = (num: number, den: number) => (den > 0 ? `${num}/${den}` : '—');
  // F9B-1 — de momento se muestra el TOTAL (mismo número que antes); el desglose a
  // 4 columnas Total/Oficial/Amistoso/Torneo (data.stats.matchStats) es F9B-2.
  const mt = data.stats.matchStats.total;
  const statCards: Array<{ key: string; value: string }> = [
    { key: 'matches', value: String(mt.matches) },
    { key: 'callups', value: ratio(data.stats.calledUp, data.stats.totalMatches) },
    { key: 'minutes', value: String(mt.minutes) },
    { key: 'goals', value: String(mt.goals) },
    { key: 'assists', value: String(mt.assists) },
    { key: 'cards', value: String(mt.yellow + mt.red) },
    { key: 'attendance', value: ratio(data.stats.trainingsAttended, data.stats.totalTrainings) },
  ];

  const radarData = DEVELOPMENT_REPORT_CATALOG.groups.map((g) => ({
    group: t(`cat_group.${g.id}`),
    value: perGroup[g.id] ?? 0,
  }));
  // C1 — segunda red: medias de los grupos del EQUIPO (si hay valoración de equipo).
  const teamPerGroup = data.teamReport
    ? computeGroupAverages(TEAM_REPORT_CATALOG, data.teamReport.scores).perGroup
    : null;
  const teamRadarData = teamPerGroup
    ? TEAM_REPORT_CATALOG.groups.map((g) => ({
        group: t(`cat_group.${g.id}`),
        value: teamPerGroup[g.id] ?? 0,
      }))
    : null;
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

  const teamGroupLabels: Record<string, string> = {
    rendimiento_colectivo: t('cat_group.rendimiento_colectivo'),
    dinamica_grupo: t('cat_group.dinamica_grupo'),
    evolucion_equipo: t('cat_group.evolucion_equipo'),
  };
  const teamEvolutionData = data.teamEvolution.map((e) => ({
    ...e,
    period: t(`period_short.${e.period}`),
  }));
  const teamEvolutionHasData = data.teamEvolution.some(
    (e) => e.rendimiento_colectivo != null || e.dinamica_grupo != null || e.evolucion_equipo != null,
  );

  const renderObjectives = (items: ObjectiveRow[]) =>
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('no_objectives')}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {items.map((o) => {
          const state = objectiveDisplayState(o.status, o.created_period, data.period);
          return (
            <li
              key={o.id}
              className="flex flex-col gap-1 rounded-md border bg-card/40 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'text-sm font-medium',
                    state === 'descartado' && 'line-through opacity-80',
                  )}
                >
                  {o.title}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                    OBJ_STATE_CLASS[state],
                  )}
                >
                  {t(`obj_state.${state}`)}
                </span>
              </div>
              {o.description ? (
                <p className="text-xs">
                  <span className="font-medium text-foreground">{t('objective_description')}: </span>
                  <span className="text-muted-foreground">{o.description}</span>
                </p>
              ) : null}
              {o.review_comment ? (
                <p className="text-xs">
                  <span className="font-medium text-foreground">{t('objective_review')}: </span>
                  <span className="text-muted-foreground">{o.review_comment}</span>
                </p>
              ) : null}
            </li>
          );
        })}
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

      {/* ── SUBIDAS A EQUIPOS SUPERIORES (D3) ───────────────────────── */}
      {data.stats.promotions.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpCircle className="size-4" aria-hidden />
              {t('ficha.promotions.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Highlight agregado por equipo superior + kind. */}
            <ul className="flex flex-col gap-1 text-sm">
              {data.stats.promotions.byTeam.map((g) => (
                <li key={g.teamName} className="flex flex-col">
                  {g.train > 0 && (
                    <span>
                      {t('ficha.promotions.highlight_train', {
                        count: g.train,
                        team: g.teamName,
                      })}
                    </span>
                  )}
                  {g.match > 0 && (
                    <span>
                      {t('ficha.promotions.highlight_match', {
                        count: g.match,
                        team: g.teamName,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {/* Detalle: fecha · equipo superior · entrenó/jugó (fecha desc). */}
            <ul className="flex flex-col divide-y divide-border">
              {data.stats.promotions.items.map((it) => (
                <li
                  key={it.eventId}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="tabular-nums">{fmtPromoDate(it.startsAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {it.teamName}
                  </span>
                  <Badge variant="outline">
                    {t(`ficha.promotions.kind_${it.kind}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── RESUMEN + REDES (individual + equipo, C1) ───────────────── */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
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
          {/* Dos redes lado a lado, cada una etiquetada (ejes distintos: individual
              = 4 corners; equipo = 3 grupos). La de equipo solo si hay valoración. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-center text-sm font-medium">{t('radar_individual')}</span>
              <GroupRadarChart data={radarData} />
            </div>
            {teamRadarData ? (
              <div className="flex flex-col gap-1">
                <span className="text-center text-sm font-medium">{t('radar_team')}</span>
                <GroupRadarChart data={teamRadarData} />
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                {t('radar_team_empty')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 3 · OBJETIVOS (individuales + grupales) ─────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('objectives_title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('objectives_individual')}</span>
            {renderObjectives(data.playerObjectives)}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('objectives_team')}</span>
            {renderObjectives(data.teamObjectives)}
          </div>
        </CardContent>
      </Card>

      {/* ── 4 · EVOLUCIÓN INDIVIDUAL ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('evolution_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {evolutionHasData ? (
            <EvolutionChart
              data={evolutionData}
              series={INDIV_EVOLUTION_SERIES}
              labels={groupLabels}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('evolution_empty')}</p>
          )}
        </CardContent>
      </Card>

      {/* ── 5 · EVOLUCIÓN DE EQUIPO (3 grupos del catálogo de equipo) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('team_evolution_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {teamEvolutionHasData ? (
            <EvolutionChart
              data={teamEvolutionData}
              series={TEAM_EVOLUTION_SERIES}
              labels={teamGroupLabels}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('evolution_empty')}</p>
          )}
        </CardContent>
      </Card>

      {/* ── 6 · RESULTADOS INDIVIDUALES (4 grupos) ──────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('results_individual')}</CardTitle>
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

      {/* ── 7 · RESULTADOS DE EQUIPO (3 grupos) ─────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('results_team')}</CardTitle>
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
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('team_block_missing')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
