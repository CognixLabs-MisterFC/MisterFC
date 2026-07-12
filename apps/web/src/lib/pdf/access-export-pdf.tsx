/**
 * F14-8 — DERECHO DE ACCESO (export del expediente del menor por el TUTOR).
 * Documento @react-pdf multi-sección. SOLO presentación: recibe datos ya
 * cargados con la sesión del tutor (RLS heredada), así que por construcción
 * contiene únicamente lo que el tutor VE en la app (regla maestra de Jose).
 *
 * Reutiliza el branding 9.B (BrandHeader/pdfStyles) y los catálogos de informe
 * (mismo render de scores que development-report-pdf, sin los gráficos SVG: el
 * export es documental, tabular). Las secciones sin datos se omiten o se marcan
 * "sin datos", nunca rompen el render.
 *
 * NO incluye (regla 5): evaluation_private_notes, player_notes, mensajes,
 * notificaciones, detalle de asistencia por sesión, ni consentimientos.
 */

import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  type DocumentProps,
} from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import {
  computeGroupAverages,
  objectiveDisplayState,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  type Catalog,
  type AggregatedStats,
  type DerivedRatios,
} from '@misterfc/core';
import type { PlayerCareer } from '@/lib/player-career';
import type { ObjectiveRow } from '@/app/[locale]/(authenticated)/jugadores/[playerId]/informes/queries';
import { scorePdfFill } from '@/lib/score-color';
import {
  BrandHeader,
  pdfStyles,
  BRAND_NAVY,
  type Translator,
} from './shared';

const NA = '—';
const BORDER = '#E2E8F0';
const MUTED = '#64748B';

const dec = (v: number | null) => (v == null ? NA : v.toFixed(2));
const pct = (v: number | null) => (v == null ? NA : `${Math.round(v * 100)}%`);
const fmt = (v: number | null) => (v == null || Number.isNaN(v) ? NA : Number.isInteger(v) ? String(v) : v.toFixed(1));

const OBJ_STATE_PDF: Record<string, { bg: string; fg: string; border: string }> = {
  nuevo: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
  en_proceso: { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' },
  conseguido: { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' },
  descartado: { bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA' },
};

const s = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 32,
    fontSize: 9,
    color: '#0F172A',
    fontFamily: 'Helvetica',
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    padding: 10,
    marginBottom: 6,
  },
  photo: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginRight: 12,
    objectFit: 'cover',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#047857', fontSize: 18, fontFamily: 'Helvetica-Bold' },
  playerName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: BRAND_NAVY },
  metaLine: { fontSize: 8.5, color: MUTED, marginTop: 3 },
  generated: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  kvLabelInline: { fontFamily: 'Helvetica-Bold', color: MUTED },
  medField: { marginBottom: 5 },
  medLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase' },
  medValue: { fontSize: 9.5, lineHeight: 1.35, color: '#1E293B', marginTop: 1 },
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
  commentLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, marginBottom: 2, marginTop: 6 },
  periodTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND_NAVY, marginTop: 4 },
  evalRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: 'flex-start' },
});

function ScoreCell({ value }: { value: number | null }) {
  const fill = scorePdfFill(value);
  return <Text style={[s.scoreCell, { backgroundColor: fill.bg, color: fill.fg }]}>{fmt(value)}</Text>;
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
              <Text style={[s.scoreCell, { backgroundColor: fill.bg, color: fill.fg }]}>{fmt(avg)}</Text>
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

export interface AccessExportReport {
  period: string;
  scores: Record<string, number>;
  commentOverall: string | null;
  teamReport: { scores: Record<string, number>; comment: string | null } | null;
  playerObjectives: ObjectiveRow[];
  teamObjectives: ObjectiveRow[];
}

export interface AccessExportEvaluation {
  eventId: string;
  startsAt: string;
  label: string;
  rating: number | null;
  isMvp: boolean;
  comment: string | null;
  teamRating: number | null;
}

export interface AccessExportSeason {
  seasonLabel: string;
  reports: AccessExportReport[];
}

export interface AccessExportProps {
  /** access_export.* */
  t: Translator;
  /** informes.* (etiquetas de catálogo, periodos, estados de objetivo). */
  tInf: Translator;
  clubName: string;
  /** F14B-9b — logo del club como data URI base64 (null → cabecera sin logo). */
  logoDataUrl: string | null;
  generatedAtLabel: string;
  playerName: string;
  initials: string;
  photoDataUrl: string | null;
  metaLine: string | null;
  teamLine: string | null;
  medical: {
    allergies: string | null;
    medication: string | null;
    medical_conditions: string | null;
    emergency_contact: string | null;
  } | null;
  seasonLabel: string | null;
  seasonStats: AggregatedStats | null;
  seasonRatios: DerivedRatios | null;
  career: PlayerCareer;
  badgeLabels: string[];
  attendancePct: number | null;
  attendanceSessions: number;
  reportSeasons: AccessExportSeason[];
  evaluations: AccessExportEvaluation[];
}

function IdentitySection(props: AccessExportProps): ReactElement {
  return (
    <View style={s.headerCard}>
      {props.photoDataUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image no soporta alt
        <Image style={s.photo} src={props.photoDataUrl} />
      ) : (
        <View style={s.avatar}>
          <Text style={s.avatarText}>{props.initials || NA}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.playerName}>{props.playerName}</Text>
        {props.metaLine ? <Text style={s.metaLine}>{props.metaLine}</Text> : null}
        {props.teamLine ? <Text style={s.metaLine}>{props.teamLine}</Text> : null}
        <Text style={s.generated}>{props.generatedAtLabel}</Text>
      </View>
    </View>
  );
}

function MedicalSection(props: AccessExportProps): ReactElement {
  const { t, medical } = props;
  const fields: Array<{ key: string; value: string | null }> = medical
    ? [
        { key: 'allergies', value: medical.allergies },
        { key: 'medication', value: medical.medication },
        { key: 'medical_conditions', value: medical.medical_conditions },
        { key: 'emergency_contact', value: medical.emergency_contact },
      ]
    : [];
  const hasAny = fields.some((f) => f.value && f.value.trim().length > 0);
  return (
    <>
      <Text style={pdfStyles.sectionTitle}>{t('section.medical')}</Text>
      {medical && hasAny ? (
        fields
          .filter((f) => f.value && f.value.trim().length > 0)
          .map((f) => (
            <View key={f.key} style={s.medField}>
              <Text style={s.medLabel}>{t(`medical.${f.key}`)}</Text>
              <Text style={s.medValue}>{f.value}</Text>
            </View>
          ))
      ) : (
        <Text style={pdfStyles.emptyText}>{t('medical.none')}</Text>
      )}
    </>
  );
}

function SportingSection(props: AccessExportProps): ReactElement {
  const { t, career, seasonStats, seasonRatios } = props;
  return (
    <>
      {seasonStats && seasonRatios ? (
        <>
          <Text style={pdfStyles.sectionTitle}>
            {t('section.season_stats', { season: props.seasonLabel ?? '' })}
          </Text>
          <View style={pdfStyles.kvGrid}>
            <KvCard value={String(seasonStats.matches)} label={t('col.matches')} />
            <KvCard value={String(seasonStats.starts)} label={t('col.starts')} />
            <KvCard value={String(seasonStats.minutesPlayed)} label={t('col.minutes')} />
            <KvCard value={String(seasonStats.goals)} label={t('col.goals')} />
            <KvCard value={String(seasonStats.assists)} label={t('col.assists')} />
            <KvCard value={String(seasonStats.yellowCards)} label={t('col.yellow')} />
            <KvCard value={String(seasonStats.redCards)} label={t('col.red')} />
            <KvCard value={pct(seasonRatios.startRate)} label={t('col.start_rate')} />
          </View>
        </>
      ) : null}

      <Text style={pdfStyles.sectionTitle}>{t('section.career')}</Text>
      <View style={pdfStyles.table}>
        <View style={pdfStyles.headRow}>
          <Text style={[pdfStyles.cellHead, { flex: 1.4 }]}>{t('col.season')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('col.matches')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('col.minutes')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('col.goals')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('col.assists')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('col.start_rate')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('col.rating')}</Text>
        </View>
        {career.bySeason.map((cs) => (
          <View key={cs.season} style={pdfStyles.row}>
            <Text style={[pdfStyles.cell, pdfStyles.bold, { flex: 1.4 }]}>{cs.season}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{cs.stats.matches}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{cs.stats.minutesPlayed}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{cs.stats.goals}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{cs.stats.assists}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{pct(cs.ratios.startRate)}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{dec(cs.rating ?? null)}</Text>
          </View>
        ))}
        <View style={pdfStyles.totalsRow}>
          <Text style={[pdfStyles.cell, pdfStyles.bold, { flex: 1.4 }]}>{t('career_totals')}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.matches}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.minutesPlayed}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.goals}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.assists}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{pct(career.totals.ratios.startRate)}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{NA}</Text>
        </View>
      </View>

      {/* Asistencia a entrenos: SOLO agregada (regla 4), el % que ya ve en badges. */}
      <Text style={pdfStyles.sectionTitle}>{t('section.attendance')}</Text>
      {props.attendanceSessions > 0 ? (
        <View style={pdfStyles.kvGrid}>
          <KvCard value={pct(props.attendancePct)} label={t('attendance.present_pct')} />
          <KvCard value={String(props.attendanceSessions)} label={t('attendance.sessions')} />
        </View>
      ) : (
        <Text style={pdfStyles.emptyText}>{t('attendance.none')}</Text>
      )}

      <Text style={pdfStyles.sectionTitle}>{t('section.achievements')}</Text>
      {props.badgeLabels.length === 0 ? (
        <Text style={pdfStyles.emptyText}>{t('achievements.none')}</Text>
      ) : (
        <View style={pdfStyles.chips}>
          {props.badgeLabels.map((label, i) => (
            <Text key={`${label}-${i}`} style={pdfStyles.chip}>
              {label}
            </Text>
          ))}
        </View>
      )}
    </>
  );
}

function KvCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={pdfStyles.kvCard}>
      <Text style={pdfStyles.kvValue}>{value}</Text>
      <Text style={pdfStyles.kvLabel}>{label}</Text>
    </View>
  );
}

function renderObjectives(items: ObjectiveRow[], period: string, tInf: Translator): ReactElement {
  if (items.length === 0) return <Text style={pdfStyles.emptyText}>{tInf('no_objectives')}</Text>;
  return (
    <>
      {items.map((o) => {
        const state = objectiveDisplayState(o.status, o.created_period, period);
        const c = OBJ_STATE_PDF[state] ?? OBJ_STATE_PDF.nuevo!;
        return (
          <View key={o.id} style={s.objItem} wrap={false}>
            <View style={s.objHeadRow}>
              <Text style={[s.objTitle, state === 'descartado' ? { textDecoration: 'line-through', color: MUTED } : {}]}>
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
      })}
    </>
  );
}

function ReportBlock({
  report,
  seasonLabel,
  tInf,
}: {
  report: AccessExportReport;
  seasonLabel: string;
  tInf: Translator;
}): ReactElement {
  return (
    <View wrap>
      <Text style={s.periodTitle}>
        {seasonLabel} · {tInf(`period.${report.period}`)}
      </Text>

      <Text style={pdfStyles.sectionTitle}>{tInf('results_individual')}</Text>
      <CatalogTable catalog={DEVELOPMENT_REPORT_CATALOG} scores={report.scores} tInf={tInf} />
      {report.commentOverall ? (
        <View>
          <Text style={s.commentLabel}>{tInf('comment_overall')}</Text>
          <Text style={s.comment}>{report.commentOverall}</Text>
        </View>
      ) : null}

      <Text style={pdfStyles.sectionTitle}>{tInf('objectives_title')}</Text>
      <Text style={s.commentLabel}>{tInf('objectives_individual')}</Text>
      {renderObjectives(report.playerObjectives, report.period, tInf)}
      <Text style={s.commentLabel}>{tInf('objectives_team')}</Text>
      {renderObjectives(report.teamObjectives, report.period, tInf)}

      {report.teamReport ? (
        <>
          <Text style={pdfStyles.sectionTitle}>{tInf('results_team')}</Text>
          <CatalogTable catalog={TEAM_REPORT_CATALOG} scores={report.teamReport.scores} tInf={tInf} />
          {report.teamReport.comment ? (
            <View>
              <Text style={s.commentLabel}>{tInf('team_comment')}</Text>
              <Text style={s.comment}>{report.teamReport.comment}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function EvaluationsSection(props: AccessExportProps): ReactElement | null {
  if (props.evaluations.length === 0) return null;
  const { t } = props;
  return (
    <>
      <Text style={pdfStyles.sectionTitle}>{t('section.evaluations')}</Text>
      <View style={pdfStyles.table}>
        <View style={pdfStyles.headRow}>
          <Text style={[pdfStyles.cellHead, { flex: 2 }]}>{t('eval.match')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('eval.rating')}</Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>{t('eval.team')}</Text>
          <Text style={[pdfStyles.cellHead, { flex: 3 }]}>{t('eval.comment')}</Text>
        </View>
        {props.evaluations.map((e) => (
          <View key={e.eventId} style={s.evalRow}>
            <Text style={[pdfStyles.cell, { flex: 2 }]}>
              {e.label}
              {e.isMvp ? '  ★' : ''}
            </Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{fmt(e.rating)}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{fmt(e.teamRating)}</Text>
            <Text style={[pdfStyles.cell, { flex: 3 }]}>{e.comment ?? NA}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

export function AccessExportDocument(props: AccessExportProps): ReactElement<DocumentProps> {
  const { t } = props;
  const hasReports = props.reportSeasons.some((rs) => rs.reports.length > 0);
  return (
    <Document>
      {/* Página 1 — identidad + médica + histórico deportivo + logros. */}
      <Page size="A4" style={s.page}>
        <BrandHeader
          clubName={props.clubName}
          logoDataUrl={props.logoDataUrl}
          title={t('title')}
          subtitle={props.playerName}
        />
        <IdentitySection {...props} />
        <MedicalSection {...props} />
        <SportingSection {...props} />
        <EvaluationsSection {...props} />
      </Page>

      {/* Página(s) 2+ — informes formales publicados (regla 4). */}
      {hasReports ? (
        <Page size="A4" style={s.page}>
          <BrandHeader
            clubName={props.clubName}
            logoDataUrl={props.logoDataUrl}
            title={t('reports_title')}
            subtitle={props.playerName}
          />
          {props.reportSeasons.flatMap((rs) =>
            rs.reports.map((r) => (
              <ReportBlock
                key={`${rs.seasonLabel}-${r.period}`}
                report={r}
                seasonLabel={rs.seasonLabel}
                tInf={props.tInf}
              />
            )),
          )}
        </Page>
      ) : null}
    </Document>
  );
}
