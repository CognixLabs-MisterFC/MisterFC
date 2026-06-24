/**
 * F13.10e — Documento PDF del INFORME DE DESARROLLO (jugador×temporada×periodo).
 * Replica la ficha (ReportFichaView) adaptada a @react-pdf: solo presentación
 * (recibe datos ya cargados + traductores). Reusa el branding 9.B (PdfShell) y los
 * tokens de color por nota (score-color → scorePdfFill, fondos de celda claros).
 *
 * D8/D10: @react-pdf NO renderiza recharts/SVG complejo → el radar y el gráfico de
 * líneas NO van al PDF; la evolución es una TABLA comparativa de las 4 medias de
 * grupo a lo largo de los periodos. La foto/mini-campo se omiten (placeholder de
 * iniciales + posición como texto).
 */

import { View, Text, StyleSheet, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import {
  computeGroupAverages,
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  DEVELOPMENT_PERIODS,
  type Catalog,
} from '@misterfc/core';
import { scorePdfFill } from '@/lib/score-color';
import { PdfShell, pdfStyles, BRAND_NAVY, type Translator } from './shared';
import type { FichaStats, PeriodAverages, ObjectiveRow } from
  '@/app/[locale]/(authenticated)/jugadores/[playerId]/informes/queries';

const NA = '—';
const BORDER = '#E2E8F0';
const MUTED = '#64748B';

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 3,
  },
  objTitle: { fontSize: 8.5, flex: 1 },
  objStatus: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', marginLeft: 8 },
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
  stats: FichaStats;
}

export function DevelopmentReportPdfDocument(
  props: DevelopmentReportPdfProps,
): ReactElement<DocumentProps> {
  const { t, tInf } = props;

  const { overall } = computeGroupAverages(DEVELOPMENT_REPORT_CATALOG, props.scores);
  const status = reportStatus(props.scores, DEVELOPMENT_REPORT_CATALOG);
  const overallFill = scorePdfFill(overall);

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

  const GROUP_KEYS = ['tecnico', 'tactico', 'fisico', 'actitud'] as const;

  const renderObjectives = (items: ObjectiveRow[]) =>
    items.length === 0 ? (
      <Text style={pdfStyles.emptyText}>{tInf('no_objectives')}</Text>
    ) : (
      items.map((o) => (
        <View key={o.id} style={s.objItem}>
          <Text style={s.objTitle}>{o.title}</Text>
          <Text style={s.objStatus}>{tInf(`status.${o.status}`)}</Text>
        </View>
      ))
    );

  const statCards: Array<{ key: string; value: string }> = [
    { key: 'matches', value: String(props.stats.matches) },
    { key: 'minutes', value: String(props.stats.minutes) },
    { key: 'goals', value: String(props.stats.goals) },
    { key: 'assists', value: String(props.stats.assists) },
    { key: 'cards', value: String(props.stats.yellow + props.stats.red) },
    {
      key: 'attendance',
      value:
        props.stats.attendancePresentPct == null
          ? NA
          : `${Math.round(props.stats.attendancePresentPct * 100)}%`,
    },
  ];

  return (
    <PdfShell
      clubName={props.clubName}
      title={`${t('title')} — ${props.playerName}`}
      subtitle={subtitleParts.join('  ·  ')}
    >
      {/* Cabecera de identidad */}
      <View style={s.headerCard}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{props.initials || '—'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.playerName}>{props.playerName}</Text>
          {metaParts.length > 0 ? <Text style={s.metaLine}>{metaParts.join('  ·  ')}</Text> : null}
        </View>
      </View>

      {/* Resumen: media global + estado */}
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

      {/* Grupos del informe individual (coloreados) */}
      <Text style={pdfStyles.sectionTitle}>{tInf('individual_report')}</Text>
      <CatalogTable catalog={DEVELOPMENT_REPORT_CATALOG} scores={props.scores} tInf={tInf} />
      {props.commentOverall ? (
        <View style={{ marginTop: 6 }}>
          <Text style={s.commentLabel}>{tInf('comment_overall')}</Text>
          <Text style={s.comment}>{props.commentOverall}</Text>
        </View>
      ) : null}

      {/* Objetivos individuales */}
      <Text style={pdfStyles.sectionTitle}>{tInf('objectives_individual')}</Text>
      {renderObjectives(props.playerObjectives)}

      {/* Evolución: tabla comparativa de las 4 medias de grupo por periodo */}
      <Text style={pdfStyles.sectionTitle}>{tInf('evolution_title')}</Text>
      <View style={pdfStyles.table}>
        <View style={pdfStyles.headRow}>
          <Text style={[pdfStyles.cellHead, { flex: 1.4 }]}>{t('group_label')}</Text>
          {DEVELOPMENT_PERIODS.map((p) => (
            <Text key={p} style={[pdfStyles.cellHead, { flex: 1, textAlign: 'center' }]}>
              {tInf(`period_short.${p}`)}
            </Text>
          ))}
        </View>
        {GROUP_KEYS.map((gk, gi) => (
          <View key={gk} style={gi === GROUP_KEYS.length - 1 ? s.evRowLast : s.evRow}>
            <Text style={s.evGroupCell}>{tInf(`cat_group.${gk}`)}</Text>
            {DEVELOPMENT_PERIODS.map((p) => {
              const row = props.evolution.find((e) => e.period === p);
              const val = row ? row[gk] : null;
              const fill = scorePdfFill(val);
              return (
                <Text
                  key={p}
                  style={[s.evCell, { backgroundColor: fill.bg, color: fill.fg }]}
                >
                  {fmt(val)}
                </Text>
              );
            })}
          </View>
        ))}
      </View>

      {/* Valoración de equipo del periodo */}
      <Text style={pdfStyles.sectionTitle}>{tInf('team_block_title')}</Text>
      {props.teamReport ? (
        <>
          <CatalogTable catalog={TEAM_REPORT_CATALOG} scores={props.teamReport.scores} tInf={tInf} />
          {props.teamReport.comment ? (
            <View style={{ marginTop: 6 }}>
              <Text style={s.commentLabel}>{tInf('team_comment')}</Text>
              <Text style={s.comment}>{props.teamReport.comment}</Text>
            </View>
          ) : null}
          <View style={{ marginTop: 6 }}>
            <Text style={s.commentLabel}>{tInf('objectives_team')}</Text>
            {renderObjectives(props.teamObjectives)}
          </View>
        </>
      ) : (
        <Text style={pdfStyles.emptyText}>{tInf('team_block_missing')}</Text>
      )}

      {/* Stats agregadas de la temporada */}
      <Text style={pdfStyles.sectionTitle}>{t('stats_title')}</Text>
      <View style={pdfStyles.kvGrid}>
        {statCards.map((c) => (
          <View key={c.key} style={pdfStyles.kvCard}>
            <Text style={pdfStyles.kvValue}>{c.value}</Text>
            <Text style={pdfStyles.kvLabel}>{tInf(`ficha.stat.${c.key}`)}</Text>
          </View>
        ))}
      </View>
    </PdfShell>
  );
}
