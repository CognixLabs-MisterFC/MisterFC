import { useState } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';
import {
  getPlayerReportBundleFromClient,
  computeGroupAverages,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  playerScopedCacheKey,
  type PlayerReportBundle,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { ChildSelector } from '@/ui/child-selector';
import { PlayerAvatar } from '@/ui/player-avatar';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/**
 * O2-5 C1 — Mi informe (informe de desarrollo publicado del HIJO ACTIVO, SOLO
 * LECTURA): medias por grupo del periodo, comentario, valoración de equipo,
 * objetivos y resumen de ficha. Orquestación + fetch en core
 * (`getPlayerReportBundleFromClient`). Caché PLAYER-SCOPED
 * (informe::clubId::playerId::season::period). Selectores de temporada y periodo.
 */
export function MiInformeScreen() {
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;
  const [season, setSeason] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);

  const { data, fromCache, loading } = useCached<PlayerReportBundle | null>(
    `${playerScopedCacheKey('informe', clubId ?? 'none', playerId ?? 'none')}::${season ?? 'def'}::${period ?? 'def'}`,
    (sb) =>
      clubId && playerId
        ? getPlayerReportBundleFromClient(sb, clubId, playerId, { season, period })
        : Promise.resolve(null),
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('informe.empty')} />;

  const rep = data.report;

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        {/* Selectores */}
        {data.seasons.length > 1 ? (
          <Chips items={data.seasons} active={data.activeSeason} accent={accent} onPick={setSeason} />
        ) : null}
        {data.periods.length > 1 ? (
          <Chips items={data.periods} active={rep?.period ?? null} accent={accent} onPick={setPeriod} labelKey="period" />
        ) : null}

        {!rep ? (
          <EmptyState message={t('informe.no_reports')} />
        ) : (
          <>
            <View className="flex-row items-center gap-3">
              <PlayerAvatar
                playerId={playerId}
                initials={(activePlayer?.name ?? '').trim().slice(0, 2)}
                accent={accent}
                size={48}
              />
              <View className="flex-1">
              <Text className="text-xl font-bold text-[#0F1B2E]">{activePlayer?.name}</Text>
              <Text className="text-xs text-zinc-400">
                {[t(`informe.period.${rep.period}`), data.activeSeason, rep.teamName].filter(Boolean).join(' · ')}
              </Text>
              </View>
            </View>

            {/* Medias por grupo (individual) */}
            <Section title={t('informe.player_scores')}>
              <GroupScores catalog={DEVELOPMENT_REPORT_CATALOG} scores={rep.scores} accent={accent} />
              {rep.commentOverall ? (
                <Text className="mt-2 text-sm text-zinc-600">{rep.commentOverall}</Text>
              ) : null}
            </Section>

            {/* Valoración de equipo */}
            {rep.teamReport ? (
              <Section title={t('informe.team_scores')}>
                <GroupScores catalog={TEAM_REPORT_CATALOG} scores={rep.teamReport.scores} accent={accent} />
                {rep.teamReport.comment ? (
                  <Text className="mt-2 text-sm text-zinc-600">{rep.teamReport.comment}</Text>
                ) : null}
              </Section>
            ) : null}

            {/* Objetivos individuales */}
            {rep.playerObjectives.length > 0 ? (
              <Section title={t('informe.player_objectives')}>
                {rep.playerObjectives.map((o) => (
                  <Objective key={o.id} title={o.title} desc={o.description} status={o.status} review={o.review_comment} />
                ))}
              </Section>
            ) : null}

            {/* Objetivos de equipo */}
            {rep.teamObjectives.length > 0 ? (
              <Section title={t('informe.team_objectives')}>
                {rep.teamObjectives.map((o) => (
                  <Objective key={o.id} title={o.title} desc={o.description} status={o.status} review={o.review_comment} />
                ))}
              </Section>
            ) : null}

            {/* Resumen de ficha */}
            <Section title={t('informe.ficha_summary')}>
              <View className="flex-row flex-wrap">
                <Metric label={t('informe.matches')} value={String(rep.fichaStats.matchStats.total.matches)} />
                <Metric label={t('informe.attendance')} value={pct(rep.fichaStats.attendancePresentPct)} />
                <Metric label={t('informe.callups')} value={`${rep.fichaStats.calledUp}/${rep.fichaStats.totalMatches}`} />
                <Metric label={t('informe.trainings')} value={`${rep.fichaStats.trainingsAttended}/${rep.fichaStats.totalTrainings}`} />
              </View>
            </Section>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function Chips({
  items,
  active,
  accent,
  onPick,
  labelKey,
}: {
  items: string[];
  active: string | null;
  accent: string;
  onPick: (v: string) => void;
  labelKey?: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((it) => {
        const on = it === active;
        return (
          <Pressable
            key={it}
            onPress={() => onPick(it)}
            className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
            style={on ? { backgroundColor: accent } : undefined}
          >
            <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>
              {labelKey === 'period' ? t(`informe.period.${it}`) : it}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function GroupScores({
  catalog,
  scores,
  accent,
}: {
  catalog: Parameters<typeof computeGroupAverages>[0];
  scores: Record<string, number>;
  accent: string;
}) {
  const { perGroup } = computeGroupAverages(catalog, scores);
  const entries = Object.entries(perGroup) as [string, number | null][];
  return (
    <View className="gap-1.5">
      {entries.map(([group, avg]) => (
        <View key={group} className="flex-row items-center justify-between">
          <Text className="text-sm text-zinc-600">{t(`informe.group.${group}`)}</Text>
          <View className="flex-row items-center gap-2">
            <View className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">
              <View className="h-full rounded-full" style={{ width: `${((avg ?? 0) / 5) * 100}%`, backgroundColor: accent }} />
            </View>
            <Text className="w-8 text-right text-sm font-semibold text-[#0F1B2E]">
              {avg == null ? '—' : avg.toFixed(1)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Objective({
  title,
  desc,
  status,
  review,
}: {
  title: string;
  desc: string | null;
  status: string;
  review: string | null;
}) {
  return (
    <View className="border-b border-zinc-100 py-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-sm font-medium text-[#0F1B2E]">{title}</Text>
        <Text className="text-[10px] uppercase tracking-wide text-zinc-400">{t(`informe.status.${status}`)}</Text>
      </View>
      {desc ? <Text className="mt-0.5 text-xs text-zinc-500">{desc}</Text> : null}
      {review ? <Text className="mt-0.5 text-xs italic text-zinc-400">{review}</Text> : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</Text>
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="w-1/2 py-1.5">
      <Text className="text-lg font-bold text-[#0F1B2E] tabular-nums">{value}</Text>
      <Text className="text-[10px] text-zinc-400">{label}</Text>
    </View>
  );
}
