import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Polyline, Circle, Line as SvgLine } from 'react-native-svg';
import {
  getClubDashboardBaseFromClient,
  getClubResultsFromClient,
  getClubAttendanceFromClient,
  getClubRankingsFromClient,
  getClubAlertsFromClient,
  getCampaignDeadlineAlertsFromClient,
  clubScopedCacheKey,
  type ClubDashboardBase,
  type TeamResults,
  type ClubAttendanceData,
  type ClubRankingsData,
  type ClubAlertsData,
  type CampaignDeadlineAlert,
  type AttendanceTrendPoint,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

type DashboardData = {
  base: ClubDashboardBase;
  results: TeamResults[];
  attendance: ClubAttendanceData;
  rankings: ClubRankingsData;
  alerts: ClubAlertsData;
  campaigns: CampaignDeadlineAlert[];
};

/**
 * O2-11b — DASHBOARD EJECUTIVO de dirección (SOLO LECTURA, club-wide). Reúne los 6
 * loaders de core (thin sobre los agregadores puros) en un único fetch cache-first
 * y pinta 5 secciones: censo (+delta), resultados, asistencia (+tendencia SVG),
 * rankings por categoría y alertas. La tendencia usa react-native-svg (sin dep de
 * charts nueva). Gate de la banda = AreaGuard('direction'). Caché `dashboard::clubId`.
 */
export function DireccionDashboardScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<DashboardData | null>(
    clubScopedCacheKey('dashboard', clubId ?? 'none'),
    async (sb) => {
      if (!clubId) return null;
      const base = await getClubDashboardBaseFromClient(sb, clubId);
      const teamIds = base.season.teamIds;
      const [results, attendance, rankings, alerts, campaigns] = await Promise.all([
        getClubResultsFromClient(sb, teamIds),
        getClubAttendanceFromClient(sb, teamIds),
        getClubRankingsFromClient(sb, teamIds),
        getClubAlertsFromClient(sb, teamIds),
        getCampaignDeadlineAlertsFromClient(sb, clubId, teamIds),
      ]);
      return { base, results, attendance, rankings, alerts, campaigns };
    },
  );

  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('dash.empty')} />;

  const { base, results, attendance, rankings, alerts, campaigns } = data;
  const teamName: Record<string, string> = {};
  for (const tm of base.census.byTeam) teamName[tm.teamId] = tm.teamName;

  const totalDelta =
    base.previousCensus != null
      ? base.census.totalPlayers - base.previousCensus.totalPlayers
      : null;
  const prevByCat = new Map(
    (base.previousCensus?.byCategory ?? []).map((c) => [c.categoryId, c.playerCount]),
  );

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <ScreenTitle>{t('dash.title')}</ScreenTitle>

        {/* 1 · CENSO */}
        <Section title={t('dash.census')}>
          <View className="flex-row items-end gap-2">
            <Text className="text-3xl font-bold text-[#0F1B2E] tabular-nums">
              {base.census.totalPlayers}
            </Text>
            <Text className="pb-1 text-xs text-zinc-400">{t('dash.total_players')}</Text>
            {totalDelta != null ? <DeltaChip delta={totalDelta} accent={accent} /> : null}
          </View>
          {base.census.byCategory.length > 0 ? (
            <View className="mt-3">
              <SubHead>{t('dashboard.census.by_category')}</SubHead>
              {base.census.byCategory.map((c) => {
                const prev = prevByCat.get(c.categoryId);
                const d = prev != null ? c.playerCount - prev : null;
                return (
                  <Row key={c.categoryId} label={c.categoryName}>
                    <Text className="text-sm font-semibold text-[#0F1B2E] tabular-nums">
                      {c.playerCount}
                    </Text>
                    {d != null ? <DeltaChip delta={d} accent={accent} small /> : null}
                  </Row>
                );
              })}
            </View>
          ) : null}
          {base.census.byTeam.length > 0 ? (
            <View className="mt-3">
              <SubHead>{t('dashboard.census.by_team')}</SubHead>
              {base.census.byTeam.map((tm) => (
                <Row key={tm.teamId} label={tm.teamName} sub={tm.categoryName}>
                  <Text className="text-sm font-semibold text-[#0F1B2E] tabular-nums">
                    {tm.playerCount}
                  </Text>
                </Row>
              ))}
            </View>
          ) : null}
        </Section>

        {/* 2 · RESULTADOS */}
        <Section title={t('dash.results')}>
          {results.length === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dash.empty')}</Text>
          ) : (
            <>
              <View className="flex-row border-b border-zinc-100 pb-1">
                <Text className="flex-1 text-[10px] font-semibold uppercase text-zinc-400">
                  {t('dashboard.census.col.team')}
                </Text>
                {[t('dashboard.results.col.played'), t('dashboard.results.col.wins'), t('dashboard.results.col.draws'), t('dashboard.results.col.losses'), t('dashboard.results.col.goal_diff')].map(
                  (h, i) => (
                    <Text key={i} className="w-8 text-right text-[10px] font-semibold uppercase text-zinc-400">
                      {h}
                    </Text>
                  ),
                )}
              </View>
              {results.map((r) => (
                <View key={r.teamId} className="flex-row items-center border-b border-zinc-50 py-1.5">
                  <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                    {teamName[r.teamId] ?? '—'}
                  </Text>
                  {[r.played, r.wins, r.draws, r.losses, r.goalDifference].map((v, i) => (
                    <Text key={i} className="w-8 text-right text-sm text-zinc-600 tabular-nums">
                      {i === 4 && v > 0 ? `+${v}` : v}
                    </Text>
                  ))}
                </View>
              ))}
            </>
          )}
        </Section>

        {/* 3 · ASISTENCIA */}
        <Section title={t('dash.attendance')}>
          {attendance.agg.club.total === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dash.empty')}</Text>
          ) : (
            <>
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-zinc-500">
                  {t('dash.club_avg')} · {attendance.agg.club.total} {t('dash.sessions')}
                </Text>
                <Text className="text-lg font-bold text-[#0F1B2E]">
                  {pct(attendance.agg.club.presentPct)}
                </Text>
              </View>

              {attendance.agg.trendByWeek.length > 0 ? (
                <View className="mt-3">
                  <SubHead>{t('dashboard.attendance.trend.title')}</SubHead>
                  <TrendChart points={attendance.agg.trendByWeek} accent={accent} />
                </View>
              ) : null}

              {attendance.agg.playerRanking.length > 0 ? (
                <View className="mt-3">
                  <SubHead>{t('dashboard.attendance.ranking')}</SubHead>
                  {attendance.agg.playerRanking.slice(0, 10).map((p, i) => (
                    <Row
                      key={p.playerId}
                      label={`${i + 1}. ${attendance.playerNames[p.playerId] ?? '—'}`}
                      sub={teamName[attendance.playerTeamId[p.playerId] ?? ''] ?? undefined}
                    >
                      <Text className="text-sm font-semibold text-[#0F1B2E]">{pct(p.breakdown.presentPct)}</Text>
                    </Row>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </Section>

        {/* 4 · RANKINGS POR CATEGORÍA */}
        <Section title={t('dash.rankings')}>
          {rankings.byCategory.length === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dash.empty')}</Text>
          ) : (
            rankings.byCategory.map((cat) => (
              <View key={cat.categoryId} className="mt-2 first:mt-0">
                <Text className="text-sm font-bold text-[#0F1B2E]">{cat.categoryName}</Text>
                <RankBlock
                  title={t('dashboard.rankings.scorers')}
                  unit={t('dash.goals')}
                  entries={cat.topScorers}
                  names={rankings.playerNames}
                  none={t('dash.none')}
                />
                <RankBlock
                  title={t('dashboard.rankings.mvps')}
                  unit="MVP"
                  entries={cat.topMvps}
                  names={rankings.playerNames}
                  none={t('dash.none')}
                />
                <RankBlock
                  title={t('dash.best_avg')}
                  unit="★"
                  entries={cat.bestAvgRating}
                  names={rankings.playerNames}
                  none={t('dash.none')}
                  decimals
                />
              </View>
            ))
          )}
        </Section>

        {/* 5 · ALERTAS */}
        <Section title={t('dashboard.alerts.title')}>
          {campaigns.length === 0 && alerts.lowAttendance.length === 0 && alerts.inactive.length === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dash.all_clear')}</Text>
          ) : (
            <>
              {campaigns.length > 0 ? (
                <View>
                  <SubHead>{t('dash.campaigns')}</SubHead>
                  {campaigns.map((c) => (
                    <Row key={c.period} label={c.period} sub={c.dueDate}>
                      <Text className="text-sm font-semibold text-amber-600 tabular-nums">{c.pending}</Text>
                    </Row>
                  ))}
                </View>
              ) : null}
              {alerts.lowAttendance.length > 0 ? (
                <View className="mt-2">
                  <SubHead>{t('dash.low_attendance')}</SubHead>
                  {alerts.lowAttendance.map((a) => (
                    <Row key={a.playerId} label={a.name} sub={teamName[a.teamId] ?? undefined}>
                      <Text className="text-sm font-semibold text-red-600">
                        {Math.round(a.presentPct * 100)}%
                      </Text>
                    </Row>
                  ))}
                </View>
              ) : null}
              {alerts.inactive.length > 0 ? (
                <View className="mt-2">
                  <SubHead>{t('dash.inactive')}</SubHead>
                  {alerts.inactive.map((a) => (
                    <Row key={a.playerId} label={a.name} sub={teamName[a.teamId] ?? undefined}>
                      <View />
                    </Row>
                  ))}
                </View>
              ) : null}
            </>
          )}
          <Text className="mt-2 text-[10px] text-zinc-400">{t('dash.criteria')}</Text>
        </Section>
      </ScrollView>
    </View>
  );
}

/** Line chart de tendencia por semana (react-native-svg, sin dep de charts). */
function TrendChart({ points, accent }: { points: AttendanceTrendPoint[]; accent: string }) {
  const { width } = useWindowDimensions();
  const W = Math.max(240, width - 64);
  const H = 120;
  const pad = 8;
  const ys = points.map((p) => (p.presentPct ?? 0) * 100);
  const n = points.length;
  const xAt = (i: number) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const yAt = (v: number) => pad + (1 - v / 100) * (H - 2 * pad);
  const poly = points.map((_, i) => `${xAt(i)},${yAt(ys[i]!)}`).join(' ');

  return (
    <View className="mt-1 rounded-xl border border-zinc-100 p-1">
      <Svg width={W} height={H}>
        {/* Guías 0/50/100% */}
        {[0, 50, 100].map((g) => (
          <SvgLine key={g} x1={pad} y1={yAt(g)} x2={W - pad} y2={yAt(g)} stroke="#f4f4f5" strokeWidth={1} />
        ))}
        {n > 1 ? <Polyline points={poly} fill="none" stroke={accent} strokeWidth={2} /> : null}
        {points.map((_, i) => (
          <Circle key={i} cx={xAt(i)} cy={yAt(ys[i]!)} r={2.5} fill={accent} />
        ))}
      </Svg>
      <View className="flex-row justify-between px-1">
        <Text className="text-[9px] text-zinc-400">{points[0]?.key ?? ''}</Text>
        <Text className="text-[9px] text-zinc-400">{points[n - 1]?.key ?? ''}</Text>
      </View>
    </View>
  );
}

function RankBlock({
  title,
  unit,
  entries,
  names,
  none,
  decimals,
}: {
  title: string;
  unit: string;
  entries: { playerId: string; value: number; rank: number }[];
  names: Record<string, string>;
  none: string;
  decimals?: boolean;
}) {
  return (
    <View className="mt-1">
      <Text className="text-[10px] font-semibold uppercase text-zinc-400">{title}</Text>
      {entries.length === 0 ? (
        <Text className="text-xs text-zinc-300">{none}</Text>
      ) : (
        entries.slice(0, 5).map((e) => (
          <View key={e.playerId} className="flex-row items-center gap-2 py-0.5">
            <Text className="w-4 text-right text-xs text-zinc-400 tabular-nums">{e.rank}</Text>
            <Text className="flex-1 text-xs text-[#0F1B2E]" numberOfLines={1}>
              {names[e.playerId] ?? '—'}
            </Text>
            <Text className="text-xs font-semibold text-zinc-600 tabular-nums">
              {decimals ? e.value.toFixed(1) : e.value} {unit}
            </Text>
          </View>
        ))
      )}
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

function SubHead({ children }: { children: string }) {
  return <Text className="mb-1 text-xs font-semibold text-[#0F1B2E]">{children}</Text>;
}

function Row({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-2 border-b border-zinc-50 py-1.5">
      <View className="flex-1">
        <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>
          {label}
        </Text>
        {sub ? <Text className="text-[10px] text-zinc-400" numberOfLines={1}>{sub}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function DeltaChip({ delta, accent, small }: { delta: number; accent: string; small?: boolean }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const cls = small ? 'text-[10px]' : 'text-xs';
  return (
    <Text
      className={`${cls} font-semibold`}
      style={{ color: up ? accent : '#dc2626' }}
    >
      {up ? '▲' : '▼'} {Math.abs(delta)}
    </Text>
  );
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
