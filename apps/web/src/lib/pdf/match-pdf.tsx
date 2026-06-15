/**
 * F7.x (X.3) — Documento PDF de las ESTADÍSTICAS DE UN PARTIDO. Solo presentación
 * (recibe datos ya cargados por el loader de X.1 + traductor). Reusa la infra de
 * 9.B: `PdfShell` (banda de marca verde/navy + club + título), `pdfStyles`
 * (tablas) y el patrón de tablas de `team-pdf`. Sin gráficos (D8): tablas.
 *
 * Asimetría staff/familia heredada del loader (no es puerta trasera): el STAFF
 * recibe marcador + tabla completa + panel de equipo; la FAMILIA solo la fila de
 * su hijo, sin marcador ni panel. Sin timeline en v1 (tablas, no cronología).
 */

import { View, Text, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import {
  formatPlayerNameNatural,
  type MatchTeamStats,
} from '@misterfc/core';
import type { MatchStatRow } from '@/app/[locale]/(authenticated)/convocatorias/[eventId]/estadisticas/queries';
import { PdfShell, pdfStyles, type Translator } from './shared';

export interface MatchPdfProps {
  t: Translator;
  clubName: string;
  teamName: string;
  opponentName: string | null;
  /** Fecha del partido ya formateada en el locale. */
  dateLabel: string;
  viewer: 'staff' | 'family';
  /** Solo staff. Marcador propio – rival. */
  score: { own: number | null; against: number | null } | null;
  players: MatchStatRow[];
  /** Solo staff. Agregados de equipo a favor/en contra. */
  team: MatchTeamStats | null;
}

const NA = '—';

/** Columnas numéricas de la tabla por jugador (clave i18n + valor por fila). */
const STAT_COLS: Array<{
  key: string;
  flex: number;
  get: (p: MatchStatRow) => number;
}> = [
  { key: 'minutes', flex: 1, get: (p) => p.minutesPlayed },
  { key: 'goals', flex: 0.9, get: (p) => p.goals },
  { key: 'assists', flex: 0.9, get: (p) => p.assists },
  { key: 'yellow', flex: 0.9, get: (p) => p.yellowCards },
  { key: 'red', flex: 0.9, get: (p) => p.redCards },
  { key: 'shots', flex: 0.9, get: (p) => p.shots },
  { key: 'fouls_committed', flex: 0.9, get: (p) => p.foulsCommitted },
  { key: 'fouls_received', flex: 0.9, get: (p) => p.foulsReceived },
  { key: 'pens_scored', flex: 0.9, get: (p) => p.penaltiesScored },
  { key: 'pens_missed', flex: 0.9, get: (p) => p.penaltiesMissed },
];

/** Filas del panel de equipo (a favor/en contra). */
const TEAM_ROWS: Array<{ key: string; field: keyof MatchTeamStats }> = [
  { key: 'corners', field: 'corners' },
  { key: 'fouls', field: 'fouls' },
  { key: 'shots', field: 'shots' },
  { key: 'yellow', field: 'yellowCards' },
  { key: 'red', field: 'redCards' },
  { key: 'offsides', field: 'offsides' },
];

export function MatchPdfDocument(
  props: MatchPdfProps,
): ReactElement<DocumentProps> {
  const { t, players, team, viewer, score } = props;

  const subtitleParts = [
    props.opponentName ? `vs ${props.opponentName}` : null,
    props.teamName,
    props.dateLabel,
  ].filter(Boolean);

  return (
    <PdfShell
      clubName={props.clubName}
      title={t('match.title')}
      subtitle={subtitleParts.join('  ·  ') || undefined}
    >
      {/* Marcador (solo staff). */}
      {viewer === 'staff' &&
      score &&
      (score.own != null || score.against != null) ? (
        <View style={pdfStyles.kvGrid}>
          <View style={pdfStyles.kvCard}>
            <Text style={pdfStyles.kvValue}>
              {(score.own ?? 0).toString()} – {(score.against ?? 0).toString()}
            </Text>
            <Text style={pdfStyles.kvLabel}>{t('match.score')}</Text>
          </View>
        </View>
      ) : null}

      {/* Tabla por jugador. */}
      <Text style={pdfStyles.sectionTitle}>
        {viewer === 'family' ? t('match.section_my_player') : t('match.by_player')}
      </Text>

      {players.length === 0 ? (
        <Text style={pdfStyles.emptyText}>{t('match.empty')}</Text>
      ) : (
        <View style={pdfStyles.table}>
          <View style={pdfStyles.headRow}>
            <Text style={[pdfStyles.cellHead, { width: 24 }]}>
              {t('col.dorsal')}
            </Text>
            <Text style={[pdfStyles.cellHead, { flex: 2.2 }]}>
              {t('col.player')}
            </Text>
            <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 0.9 }]}>
              {t('col.starter')}
            </Text>
            {STAT_COLS.map((c) => (
              <Text
                key={c.key}
                style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: c.flex }]}
              >
                {t(`col.${c.key}`)}
              </Text>
            ))}
          </View>

          {players.map((p) => (
            <View key={p.playerId} style={pdfStyles.row}>
              <Text style={[pdfStyles.cell, pdfStyles.muted, { width: 24 }]}>
                {p.dorsal != null ? `#${p.dorsal}` : NA}
              </Text>
              <Text style={[pdfStyles.cell, pdfStyles.bold, { flex: 2.2 }]}>
                {formatPlayerNameNatural(p.firstName, p.lastName)}
              </Text>
              <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 0.9 }]}>
                {p.started ? t('match.starter_yes') : NA}
              </Text>
              {STAT_COLS.map((c) => (
                <Text
                  key={c.key}
                  style={[pdfStyles.cell, pdfStyles.cellNum, { flex: c.flex }]}
                >
                  {c.get(p)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* Panel de equipo a favor/en contra (solo staff). */}
      {viewer === 'staff' && team ? (
        <>
          <Text style={pdfStyles.sectionTitle}>{t('match.team.title')}</Text>
          <View style={pdfStyles.table}>
            <View style={pdfStyles.headRow}>
              <Text style={[pdfStyles.cellHead, { flex: 2 }]} />
              <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>
                {t('match.team.us')}
              </Text>
              <Text style={[pdfStyles.cellHead, pdfStyles.cellNum, { flex: 1 }]}>
                {t('match.team.them')}
              </Text>
            </View>
            {TEAM_ROWS.map((r) => {
              const pair = team[r.field];
              return (
                <View key={r.key} style={pdfStyles.row}>
                  <Text style={[pdfStyles.cell, { flex: 2 }]}>
                    {t(`match.team.${r.key}`)}
                  </Text>
                  <Text
                    style={[
                      pdfStyles.cell,
                      pdfStyles.cellNum,
                      pdfStyles.bold,
                      { flex: 1 },
                    ]}
                  >
                    {pair.own}
                  </Text>
                  <Text
                    style={[
                      pdfStyles.cell,
                      pdfStyles.cellNum,
                      pdfStyles.muted,
                      { flex: 1 },
                    ]}
                  >
                    {pair.rival}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {viewer === 'family' ? (
        <Text style={[pdfStyles.emptyText, { marginTop: 8 }]}>
          {t('match.family_note')}
        </Text>
      ) : null}
    </PdfShell>
  );
}
