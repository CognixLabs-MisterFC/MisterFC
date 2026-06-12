/**
 * F9.B-6 — Documento PDF del jugador. Solo presentación (recibe datos ya
 * cargados + traductor). Reusa los agregados de `loadPlayerCareer` (9.B-2) y
 * las badges de `loadPlayerBadges` (9.B-5, ya resueltas a etiquetas). Sin
 * gráficos (D8): tablas y tarjetas. El flag de rating lo aplica el server antes
 * (badges de rating y valoración solo si ON).
 */

import { View, Text, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import type { AggregatedStats, DerivedRatios } from '@misterfc/core';
import type { PlayerCareer } from '@/lib/player-career';
import { PdfShell, pdfStyles, type Translator } from './shared';

export interface PlayerPdfProps {
  t: Translator;
  clubName: string;
  playerName: string;
  dorsal: number | null;
  /** "Equipo · Categoría · Temporada" del equipo actual (o null). */
  teamLine: string | null;
  seasonLabel: string | null;
  seasonStats: AggregatedStats | null;
  seasonRatios: DerivedRatios | null;
  career: PlayerCareer;
  /** Etiquetas de logros ya resueltas en el server (nombre + nivel). */
  badgeLabels: string[];
}

const NA = '—';
const dec = (v: number | null) => (v == null ? NA : v.toFixed(2));
const whole = (v: number | null) => (v == null ? NA : Math.round(v).toString());
const pct = (v: number | null) => (v == null ? NA : `${Math.round(v * 100)}%`);

function KvCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={pdfStyles.kvCard}>
      <Text style={pdfStyles.kvValue}>{value}</Text>
      <Text style={pdfStyles.kvLabel}>{label}</Text>
    </View>
  );
}

export function PlayerPdfDocument(
  props: PlayerPdfProps
): ReactElement<DocumentProps> {
  const { t, career, seasonStats, seasonRatios } = props;
  const subtitleParts = [
    props.dorsal != null ? `#${props.dorsal}` : null,
    props.teamLine,
  ].filter(Boolean);

  return (
    <PdfShell
      clubName={props.clubName}
      title={`${t('player.title')} — ${props.playerName}`}
      subtitle={subtitleParts.join('  ·  ') || undefined}
    >
      {/* Stats de la temporada (la más reciente). */}
      {seasonStats && seasonRatios ? (
        <>
          <Text style={pdfStyles.sectionTitle}>
            {t('player.season_stats', { season: props.seasonLabel ?? '' })}
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
            <KvCard value={dec(seasonRatios.goalsPerMatch)} label={t('col.goals_per_match')} />
            <KvCard value={dec(seasonRatios.goalsPer90)} label={t('col.goals_per_90')} />
            <KvCard value={dec(seasonRatios.assistsPerMatch)} label={t('col.assists_per_match')} />
            <KvCard value={whole(seasonRatios.minutesPerMatch)} label={t('col.minutes_per_match')} />
          </View>
        </>
      ) : null}

      {/* Carrera: totales + por temporada. */}
      <Text style={pdfStyles.sectionTitle}>{t('player.career')}</Text>
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
        {career.bySeason.map((s) => (
          <View key={s.season} style={pdfStyles.row}>
            <Text style={[pdfStyles.cell, pdfStyles.bold, { flex: 1.4 }]}>{s.season}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{s.stats.matches}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{s.stats.minutesPlayed}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{s.stats.goals}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{s.stats.assists}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{pct(s.ratios.startRate)}</Text>
            <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{dec(s.rating)}</Text>
          </View>
        ))}
        <View style={pdfStyles.totalsRow}>
          <Text style={[pdfStyles.cell, pdfStyles.bold, { flex: 1.4 }]}>{t('player.career_totals')}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.matches}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.minutesPlayed}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.goals}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{career.totals.stats.assists}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, pdfStyles.bold, { flex: 1 }]}>{pct(career.totals.ratios.startRate)}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellNum, { flex: 1 }]}>{NA}</Text>
        </View>
      </View>

      {/* Logros. */}
      <Text style={pdfStyles.sectionTitle}>{t('player.achievements')}</Text>
      {props.badgeLabels.length === 0 ? (
        <Text style={pdfStyles.emptyText}>{t('player.no_achievements')}</Text>
      ) : (
        <View style={pdfStyles.chips}>
          {props.badgeLabels.map((label, i) => (
            <Text key={`${label}-${i}`} style={pdfStyles.chip}>
              {label}
            </Text>
          ))}
        </View>
      )}
    </PdfShell>
  );
}
