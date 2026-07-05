/**
 * F9.B-7 — Documento PDF del equipo. Solo presentación. Reusa el agregado de
 * `loadTeamSeasonStats` / `aggregateTeamStats` (9.B-0): tabla por jugador + fila
 * de totales. Sin badges en v1. Sin gráficos (D8).
 */

import { View, Text, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { formatPlayerName, type TeamAggregate } from '@misterfc/core';
import type {
  MatchStatsByTypeRow,
  MatchStatsByTypeColumns,
} from '@/components/stats/match-stats-by-type-table';
import { PdfShell, pdfStyles, type Translator } from './shared';

export interface TeamPdfProps {
  t: Translator;
  clubName: string;
  teamName: string;
  categoryName: string;
  season: string;
  aggregate: TeamAggregate;
  /** F9B-4b — bloque "Totales del equipo" por tipo + columna Rival (paridad web). */
  byTypeTitle: string;
  byTypeColumns: Required<MatchStatsByTypeColumns>;
  byTypeRows: MatchStatsByTypeRow[];
}

const NA = '—';
const pct = (v: number | null) => (v == null ? NA : `${Math.round(v * 100)}%`);

export function TeamPdfDocument(
  props: TeamPdfProps
): ReactElement<DocumentProps> {
  const { t, aggregate } = props;
  const { perPlayer } = aggregate;

  const headCols: Array<{ key: string; flex: number }> = [
    { key: 'matches', flex: 1 },
    { key: 'starts', flex: 1 },
    { key: 'minutes', flex: 1 },
    { key: 'goals', flex: 1 },
    { key: 'assists', flex: 1 },
    { key: 'yellow', flex: 1 },
    { key: 'red', flex: 1 },
    { key: 'start_rate', flex: 1.1 },
  ];

  return (
    <PdfShell
      clubName={props.clubName}
      title={t('team.title')}
      subtitle={`${props.teamName}  ·  ${props.categoryName}  ·  ${props.season}`}
    >
      {/* F9B-4b — Totales del equipo por tipo (Amistoso·Torneo·Oficial·Total) +
          Rival. Oficial en negrita; Amistoso/Torneo/Rival tenues. */}
      <Text style={pdfStyles.sectionTitle}>{props.byTypeTitle}</Text>
      <View style={[pdfStyles.table, { marginBottom: 10 }]}>
        <View style={pdfStyles.headRow}>
          <Text style={[pdfStyles.cellHead, { flex: 2 }]} />
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>
            {props.byTypeColumns.friendly}
          </Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>
            {props.byTypeColumns.tournament}
          </Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>
            {props.byTypeColumns.official}
          </Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>
            {props.byTypeColumns.total}
          </Text>
          <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>
            {props.byTypeColumns.rival}
          </Text>
        </View>
        {props.byTypeRows.map((r) => (
          <View key={r.key} style={pdfStyles.row}>
            <Text style={[pdfStyles.cell, { flex: 2 }]}>{r.label}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.muted, { flex: 1 }]}>
              {r.cells.amistoso}
            </Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.muted, { flex: 1 }]}>
              {r.cells.torneo}
            </Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>
              {r.cells.oficial}
            </Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>
              {r.cells.total}
            </Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.muted, { flex: 1 }]}>
              {r.cells.rival ?? NA}
            </Text>
          </View>
        ))}
      </View>

      <Text style={pdfStyles.sectionTitle}>{t('team.by_player')}</Text>

      {perPlayer.length === 0 ? (
        <Text style={pdfStyles.emptyText}>{t('team.empty')}</Text>
      ) : (
        <View style={pdfStyles.table}>
          <View style={pdfStyles.headRow}>
            <Text style={[pdfStyles.cellHead, { width: 26 }]}>{t('col.dorsal')}</Text>
            <Text style={[pdfStyles.cellHead, { flex: 2.4 }]}>{t('col.player')}</Text>
            {headCols.map((c) => (
              <Text
                key={c.key}
                style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: c.flex }]}
              >
                {t(`col.${c.key}`)}
              </Text>
            ))}
          </View>

          {perPlayer.map((p) => (
            <View key={p.player_id} style={pdfStyles.row}>
              <Text style={[pdfStyles.cell, pdfStyles.muted, { width: 26 }]}>
                {p.dorsal_in_team != null ? `#${p.dorsal_in_team}` : NA}
              </Text>
              <Text style={[pdfStyles.cell, pdfStyles.bold, { flex: 2.4 }]}>
                {formatPlayerName(p.first_name, p.last_name)}
              </Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{p.stats.matches}</Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{p.stats.starts}</Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{p.stats.minutesPlayed}</Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{p.stats.goals}</Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{p.stats.assists}</Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{p.stats.yellowCards}</Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{p.stats.redCards}</Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1.1 }]}>{pct(p.ratios.startRate)}</Text>
            </View>
          ))}
        </View>
      )}
    </PdfShell>
  );
}
