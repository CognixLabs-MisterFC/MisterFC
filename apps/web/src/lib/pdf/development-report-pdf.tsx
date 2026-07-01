/**
 * F13.10e / F13.10h-PDF — Documento PDF del INFORME DE DESARROLLO
 * (jugador×temporada×periodo). Replica la ficha (ReportFichaView) adaptada a
 * @react-pdf: solo presentación (recibe datos ya cargados + traductores). Reusa el
 * branding 9.B (PdfShell) y los tokens de color por nota (scorePdfFill).
 *
 * F13.10h-PDF — alineado al nuevo orden de la ficha (7 secciones), objetivos con
 * estado DERIVADO + 2 comentarios, stats con ratios. Los GRÁFICOS van en SVG
 * NATIVO (radar + líneas de evolución individual y de equipo) — ver
 * report-charts-pdf; revierte la antigua D10 (que los dejaba como tabla). La
 * foto/mini-campo se omiten (placeholder de iniciales + posición como texto).
 */

import { View, Text, StyleSheet, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import {
  computeGroupAverages,
  reportStatus,
  objectiveDisplayState,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  DEVELOPMENT_PERIODS,
  type Catalog,
  type PlayerPosition,
} from '@misterfc/core';
import { scorePdfFill } from '@/lib/score-color';
import { PdfShell, pdfStyles, BRAND_NAVY, type Translator } from './shared';
import { RadarPdf, EvolutionLinesPdf } from './report-charts-pdf';
import { PositionFieldPdf } from './position-field-pdf';
import type {
  FichaStats,
  PdfMatchStatsSplit,
  PeriodAverages,
  TeamPeriodAverages,
  ObjectiveRow,
} from '@/app/[locale]/(authenticated)/jugadores/[playerId]/informes/queries';

const NA = '—';
const BORDER = '#E2E8F0';
const MUTED = '#64748B';

/** Series (clave→color) de los gráficos de evolución (idénticas a la ficha, H-3). */
const INDIV_SERIES = [
  { key: 'tecnico', color: '#34d399' },
  { key: 'tactico', color: '#60a5fa' },
  { key: 'fisico', color: '#fbbf24' },
  { key: 'actitud', color: '#c084fc' },
];
const TEAM_SERIES = [
  { key: 'rendimiento_colectivo', color: '#34d399' },
  { key: 'dinamica_grupo', color: '#60a5fa' },
  { key: 'evolucion_equipo', color: '#fbbf24' },
];

/** Color por estado mostrado del objetivo (equivalente PDF de OBJ_STATE_CLASS). */
const OBJ_STATE_PDF: Record<string, { bg: string; fg: string; border: string }> = {
  nuevo: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
  en_proceso: { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' },
  conseguido: { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' },
  descartado: { bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA' },
};

const s = StyleSheet.create({
  // Cabecera de identidad.
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    padding: 10,
    marginBottom: 4,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#047857', fontSize: 14, fontFamily: 'Helvetica-Bold' },
  playerName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: BRAND_NAVY },
  metaLine: { fontSize: 8, color: MUTED, marginTop: 2 },
  // Resumen media global + estado.
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  radarsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
  radarCol: { alignItems: 'center' },
  radarLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#475569', marginBottom: 2 },
  overallBox: {
    minWidth: 44,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  overallValue: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  // Tabla de grupos.
  groupHead: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderTopWidth: 1,
    borderTopColor: BRAND_NAVY,
  },
  groupHeadText: { fontFamily: 'Helvetica-Bold', color: BRAND_NAVY, fontSize: 9 },
  itemRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  itemName: { flex: 1, paddingVertical: 3, paddingHorizontal: 6, fontSize: 8.5 },
  scoreCell: {
    width: 46,
    paddingVertical: 3,
    textAlign: 'center',
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },
  // Tabla de evolución.
  evRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  evRowLast: { flexDirection: 'row' },
  evGroupCell: { flex: 1.4, paddingVertical: 4, paddingHorizontal: 6, fontSize: 8.5 },
  evCell: { flex: 1, paddingVertical: 4, textAlign: 'center', fontFamily: 'Helvetica-Bold', fontSize: 9 },
  // Objetivos.
  objItem: {
    flexDirection: 'column',
    gap: 2,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 3,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 3,
  },
  objHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  objTitle: { fontSize: 8.5, flex: 1 },
  objBadge: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  objComment: { fontSize: 8, lineHeight: 1.3, color: '#334155' },
  objCommentLabel: { fontFamily: 'Helvetica-Bold', color: MUTED },
  comment: { fontSize: 8.5, lineHeight: 1.35, color: '#1E293B' },
  commentLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, marginBottom: 2 },
});

function fmt(value: number | null): string {
  if (value == null || Number.isNaN(value)) return NA;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Celda de nota coloreada (fondo claro + texto del tramo). */
function ScoreCell({ value }: { value: number | null }) {
  const fill = scorePdfFill(value);
  return (
    <Text style={[s.scoreCell, { backgroundColor: fill.bg, color: fill.fg }]}>{fmt(value)}</Text>
  );
}

/** Tabla de un catálogo: por grupo → cabecera con media + filas de ítem coloreadas. */
function CatalogTable({
  catalog,
  scores,
  tInf,
}: {
  catalog: Catalog;
  scores: Record<string, number>;
  tInf: Translator;
}): ReactElement {
  const { perGroup } = computeGroupAverages(catalog, scores);
  return (
    <View style={[pdfStyles.table, { marginTop: 4 }]}>
      {catalog.groups.map((g) => {
        const avg = perGroup[g.id] ?? null;
        const fill = scorePdfFill(avg);
        return (
          <View key={g.id} wrap={false}>
            <View style={s.groupHead}>
              <Text style={[s.itemName, s.groupHeadText]}>{tInf(`cat_group.${g.id}`)}</Text>
              <Text style={[s.scoreCell, { backgroundColor: fill.bg, color: fill.fg }]}>
                {fmt(avg)}
              </Text>
            </View>
            {g.items.map((item) => (
              <View key={item} style={s.itemRow}>
                <Text style={s.itemName}>{tInf(`cat.${item}`)}</Text>
                <ScoreCell value={typeof scores[item] === 'number' ? scores[item]! : null} />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

export interface DevelopmentReportPdfProps {
  /** pdf.development.* */
  t: Translator;
  /** informes.* (etiquetas de catálogo, periodos, estados, secciones). */
  tInf: Translator;
  clubName: string;
  playerName: string;
  initials: string;
  dorsal: number | null;
  /** Etiquetas ya traducidas en el server (posición principal / pie). */
  positionLabel: string | null;
  footLabel: string | null;
  /** Posición principal + secundarias (valores crudos) para el mini-campo (C2). */
  primaryPos: PlayerPosition | null;
  secondaryPos: string[];
  age: number | null;
  teamName: string;
  seasonLabel: string;
  period: string;
  scores: Record<string, number>;
  commentOverall: string | null;
  teamReport: { scores: Record<string, number>; comment: string | null } | null;
  playerObjectives: ObjectiveRow[];
  teamObjectives: ObjectiveRow[];
  evolution: PeriodAverages[];
  teamEvolution: TeamPeriodAverages[];
  stats: FichaStats;
  /** Bloque de partido segregado por tipo (PDF-3: oficial vs amistoso). */
  matchStatsByType: PdfMatchStatsSplit;
  /** D4 — locale para formatear las fechas de las subidas (seguimiento). */
  locale: string;
}

export function DevelopmentReportPdfDocument(
  props: DevelopmentReportPdfProps,
): ReactElement<DocumentProps> {
  const { t, tInf } = props;

  const { perGroup, overall } = computeGroupAverages(DEVELOPMENT_REPORT_CATALOG, props.scores);
  const status = reportStatus(props.scores, DEVELOPMENT_REPORT_CATALOG);
  const overallFill = scorePdfFill(overall);
  const radarAxes = DEVELOPMENT_REPORT_CATALOG.groups.map((g) => ({
    label: tInf(`cat_group.${g.id}`),
    value: perGroup[g.id] ?? null,
  }));
  // C1 — segunda red: medias de los grupos del EQUIPO (si hay valoración de equipo).
  const teamPerGroup = props.teamReport
    ? computeGroupAverages(TEAM_REPORT_CATALOG, props.teamReport.scores).perGroup
    : null;
  const teamRadarAxes = teamPerGroup
    ? TEAM_REPORT_CATALOG.groups.map((g) => ({
        label: tInf(`cat_group.${g.id}`),
        value: teamPerGroup[g.id] ?? null,
      }))
    : null;

  const metaParts = [
    props.age != null ? tInf('age', { age: props.age }) : null,
    props.positionLabel,
    props.footLabel,
    props.dorsal != null ? `#${props.dorsal}` : null,
  ].filter(Boolean) as string[];

  const subtitleParts = [
    props.teamName,
    props.seasonLabel,
    tInf(`period.${props.period}`),
  ].filter(Boolean) as string[];

  const indivSeries = INDIV_SERIES.map((sd) => ({ ...sd, label: tInf(`cat_group.${sd.key}`) }));
  const teamSeries = TEAM_SERIES.map((sd) => ({ ...sd, label: tInf(`cat_group.${sd.key}`) }));
  const evolutionHasData = props.evolution.some(
    (e) => e.tecnico != null || e.tactico != null || e.fisico != null || e.actitud != null,
  );
  const teamEvolutionHasData = props.teamEvolution.some(
    (e) => e.rendimiento_colectivo != null || e.dinamica_grupo != null || e.evolucion_equipo != null,
  );

  // F13.10h-PDF — objetivos con estado DERIVADO + 2 comentarios (proyección /
  // revisión), igual que la ficha. El status persistido sigue siendo crudo.
  const renderObjectives = (items: ObjectiveRow[]) =>
    items.length === 0 ? (
      <Text style={pdfStyles.emptyText}>{tInf('no_objectives')}</Text>
    ) : (
      items.map((o) => {
        const state = objectiveDisplayState(o.status, o.created_period, props.period);
        const c = OBJ_STATE_PDF[state]!;
        return (
          <View key={o.id} style={s.objItem}>
            <View style={s.objHeadRow}>
              <Text
                style={[
                  s.objTitle,
                  state === 'descartado' ? { textDecoration: 'line-through', color: MUTED } : {},
                ]}
              >
                {o.title}
              </Text>
              <Text style={[s.objBadge, { backgroundColor: c.bg, color: c.fg, borderColor: c.border }]}>
                {tInf(`obj_state.${state}`)}
              </Text>
            </View>
            {o.description ? (
              <Text style={s.objComment}>
                <Text style={s.objCommentLabel}>{tInf('objective_description')}: </Text>
                {o.description}
              </Text>
            ) : null}
            {o.review_comment ? (
              <Text style={s.objComment}>
                <Text style={s.objCommentLabel}>{tInf('objective_review')}: </Text>
                {o.review_comment}
              </Text>
            ) : null}
          </View>
        );
      })
    );

  const ratio = (num: number, den: number) => (den > 0 ? `${num}/${den}` : NA);
  // Bloque de partido segregado oficial/amistoso (PDF-3).
  const { oficial, amistoso } = props.matchStatsByType;
  const matchRows: Array<{ key: string; oficial: number; amistoso: number }> = [
    { key: 'matches', oficial: oficial.matches, amistoso: amistoso.matches },
    { key: 'minutes', oficial: oficial.minutes, amistoso: amistoso.minutes },
    { key: 'goals', oficial: oficial.goals, amistoso: amistoso.goals },
    { key: 'assists', oficial: oficial.assists, amistoso: amistoso.assists },
    { key: 'cards', oficial: oficial.cards, amistoso: amistoso.cards },
  ];
  // Totales NO segregados (convocatorias + entrenos).
  const totalCards: Array<{ key: string; value: string }> = [
    { key: 'callups', value: ratio(props.stats.calledUp, props.stats.totalMatches) },
    { key: 'attendance', value: ratio(props.stats.trainingsAttended, props.stats.totalTrainings) },
  ];

  // D4 — subidas a equipos superiores (mismos datos que la ficha web, D3).
  const promo = props.stats.promotions;
  const promoHighlights: string[] = [];
  for (const g of promo.byTeam) {
    if (g.train > 0)
      promoHighlights.push(
        tInf('ficha.promotions.highlight_train', { count: g.train, team: g.teamName }),
      );
    if (g.match > 0)
      promoHighlights.push(
        tInf('ficha.promotions.highlight_match', { count: g.match, team: g.teamName }),
      );
  }
  const fmtPromoDate = (iso: string) =>
    new Intl.DateTimeFormat(props.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Madrid',
    }).format(new Date(iso));

  return (
    <PdfShell
      clubName={props.clubName}
      title={`${t('title')} — ${props.playerName}`}
      subtitle={subtitleParts.join('  ·  ')}
    >
      {/* ── 1 · Datos del jugador + stats (con ratios) ──────────────── */}
      <View style={s.headerCard}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{props.initials || '—'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.playerName}>{props.playerName}</Text>
          {metaParts.length > 0 ? <Text style={s.metaLine}>{metaParts.join('  ·  ')}</Text> : null}
        </View>
        {/* Mini-campo con la posición (principal sólida + secundarias tenues, C2).
            Se omite limpio si el jugador no tiene posición asignada. */}
        <PositionFieldPdf primary={props.primaryPos} secondary={props.secondaryPos} width={64} />
      </View>
      {/* Bloque de partido segregado: Oficial vs Amistoso */}
      <View style={[pdfStyles.table, { marginTop: 4 }]}>
        <View style={pdfStyles.headRow}>
          <Text style={[pdfStyles.cellHead, { flex: 1.4 }]}>{tInf('ficha.match_block')}</Text>
          <Text style={[pdfStyles.cellHead, { flex: 1, textAlign: 'center' }]}>
            {tInf('ficha.official')}
          </Text>
          <Text style={[pdfStyles.cellHead, { flex: 1, textAlign: 'center' }]}>
            {tInf('ficha.friendly')}
          </Text>
        </View>
        {matchRows.map((r) => (
          <View key={r.key} style={s.itemRow}>
            <Text style={s.itemName}>{tInf(`ficha.stat.${r.key}`)}</Text>
            <Text style={s.evCell}>{String(r.oficial)}</Text>
            <Text style={s.evCell}>{String(r.amistoso)}</Text>
          </View>
        ))}
      </View>
      {/* Totales no segregados: convocatorias + entrenos */}
      <View style={[pdfStyles.kvGrid, { marginTop: 4 }]}>
        {totalCards.map((c) => (
          <View key={c.key} style={pdfStyles.kvCard}>
            <Text style={pdfStyles.kvValue}>{c.value}</Text>
            <Text style={pdfStyles.kvLabel}>{tInf(`ficha.stat.${c.key}`)}</Text>
          </View>
        ))}
      </View>

      {/* Subidas a equipos superiores (D4). Se omite limpio si no hay ninguna. */}
      {promo.items.length > 0 ? (
        <>
          <Text style={pdfStyles.sectionTitle} wrap={false}>
            {tInf('ficha.promotions.title')}
          </Text>
          {promoHighlights.map((h) => (
            <Text key={h} style={{ fontSize: 9, marginBottom: 2 }}>
              {h}
            </Text>
          ))}
          <View style={[pdfStyles.table, { marginTop: 2 }]}>
            {promo.items.map((it) => (
              <View key={it.eventId} style={s.itemRow}>
                <Text style={[s.itemName, { flex: 1.2 }]}>{fmtPromoDate(it.startsAt)}</Text>
                <Text style={[s.itemName, { flex: 2 }, pdfStyles.muted]}>{it.teamName}</Text>
                <Text style={[s.itemName, { flex: 1, textAlign: 'right' }]}>
                  {tInf(`ficha.promotions.kind_${it.kind}`)}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* ── 2 · Puntuación + radar ───────────────────────────────────── */}
      <Text style={pdfStyles.sectionTitle}>{tInf('overall_average')}</Text>
      <View style={s.summaryRow}>
        <View style={[s.overallBox, { backgroundColor: overallFill.bg }]}>
          <Text style={[s.overallValue, { color: overallFill.fg }]}>{fmt(overall)}</Text>
        </View>
        <Text style={{ fontSize: 9 }}>
          <Text style={pdfStyles.muted}>{tInf('status_label')}: </Text>
          <Text style={pdfStyles.bold}>{tInf(`report_status.${status}`)}</Text>
        </Text>
      </View>
      {/* Dos redes lado a lado: individual + equipo (cada una con su etiqueta). La
          de equipo solo si hay valoración de equipo en el periodo (C1). */}
      <View style={s.radarsRow}>
        <View style={s.radarCol}>
          <Text style={s.radarLabel}>{tInf('radar_individual')}</Text>
          <RadarPdf axes={radarAxes} />
        </View>
        {teamRadarAxes ? (
          <View style={s.radarCol}>
            <Text style={s.radarLabel}>{tInf('radar_team')}</Text>
            <RadarPdf axes={teamRadarAxes} />
          </View>
        ) : null}
      </View>

      {/* ── 3 · Objetivos (individuales + grupales) ──────────────────── */}
      <Text style={pdfStyles.sectionTitle} wrap={false}>{tInf('objectives_title')}</Text>
      <Text style={s.commentLabel}>{tInf('objectives_individual')}</Text>
      {renderObjectives(props.playerObjectives)}
      <View style={{ marginTop: 4 }}>
        <Text style={s.commentLabel}>{tInf('objectives_team')}</Text>
        {renderObjectives(props.teamObjectives)}
      </View>

      {/* ── 4 · Evolución individual (líneas SVG) ────────────────────── */}
      <Text style={pdfStyles.sectionTitle}>{tInf('evolution_title')}</Text>
      {evolutionHasData ? (
        <EvolutionLinesPdf
          rows={props.evolution}
          periods={DEVELOPMENT_PERIODS}
          periodLabel={(p) => tInf(`period_short.${p}`)}
          series={indivSeries}
        />
      ) : (
        <Text style={pdfStyles.emptyText}>{tInf('evolution_empty')}</Text>
      )}

      {/* ── 5 · Evolución de equipo (líneas SVG) ─────────────────────── */}
      <Text style={pdfStyles.sectionTitle}>{tInf('team_evolution_title')}</Text>
      {teamEvolutionHasData ? (
        <EvolutionLinesPdf
          rows={props.teamEvolution}
          periods={DEVELOPMENT_PERIODS}
          periodLabel={(p) => tInf(`period_short.${p}`)}
          series={teamSeries}
        />
      ) : (
        <Text style={pdfStyles.emptyText}>{tInf('evolution_empty')}</Text>
      )}

      {/* ── 6 · Resultados individuales (4 grupos) ───────────────────── */}
      <Text style={pdfStyles.sectionTitle}>{tInf('results_individual')}</Text>
      <CatalogTable catalog={DEVELOPMENT_REPORT_CATALOG} scores={props.scores} tInf={tInf} />
      {props.commentOverall ? (
        <View style={{ marginTop: 6 }}>
          <Text style={s.commentLabel}>{tInf('comment_overall')}</Text>
          <Text style={s.comment}>{props.commentOverall}</Text>
        </View>
      ) : null}

      {/* ── 7 · Resultados de equipo (3 grupos) ──────────────────────── */}
      <Text style={pdfStyles.sectionTitle}>{tInf('results_team')}</Text>
      {props.teamReport ? (
        <>
          <CatalogTable catalog={TEAM_REPORT_CATALOG} scores={props.teamReport.scores} tInf={tInf} />
          {props.teamReport.comment ? (
            <View style={{ marginTop: 6 }}>
              <Text style={s.commentLabel}>{tInf('team_comment')}</Text>
              <Text style={s.comment}>{props.teamReport.comment}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={pdfStyles.emptyText}>{tInf('team_block_missing')}</Text>
      )}
    </PdfShell>
  );
}
