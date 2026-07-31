import { ScrollView, Text, View } from 'react-native';
import {
  getMatchStatsHeaderFromClient,
  getFamilyMatchStatRowsFromClient,
  playerEventScopedCacheKey,
  type MatchStatsHeader,
  type FamilyMatchStatRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';

type MatchStatsView = {
  header: MatchStatsHeader;
  rows: FamilyMatchStatRow[];
} | null;

/**
 * O2-5 E1 — Fila del HIJO ACTIVO en las estadísticas del partido (SOLO LECTURA).
 * Ruta del censo "sin gate explícito" → se confía en RLS (la familia solo lee su
 * `match_player_stats`) + AreaGuard('family'); si RLS deniega o no hay fila →
 * "no disponible". El fetch vive en core. Caché player+event-scoped.
 */
export function EstadisticasScreen({ eventId }: { eventId: string | null }) {
  const { activeClub } = useApp();
  const { activePlayer } = useActivePlayer();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;

  const { data, fromCache, loading } = useCached<MatchStatsView>(
    playerEventScopedCacheKey('stats-partido', clubId ?? 'none', playerId ?? 'none', eventId ?? 'none'),
    async (sb) => {
      if (!clubId || !playerId || !eventId) return null;
      const header = await getMatchStatsHeaderFromClient(sb, clubId, eventId);
      if (!header) return null;
      const rows = await getFamilyMatchStatRowsFromClient(sb, eventId, [playerId]);
      return { header, rows };
    },
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (!eventId) return <EmptyState message={t('stats.unavailable')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('stats.unavailable')} />;

  const { header, rows } = data;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('stats.title')}</ScreenTitle>

        <View className="rounded-2xl border border-zinc-200 p-4">
          <Text className="text-lg font-bold text-[#0F1B2E]">
            {header.title}
            {header.opponentName ? ` · ${header.opponentName}` : ''}
          </Text>
          <Text className="mt-1 text-xs text-zinc-400">
            {[new Date(header.startsAt).toLocaleDateString(), header.teamName].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {rows.length === 0 ? (
          <EmptyState message={t('stats.empty')} />
        ) : (
          rows.map((r) => (
            <View key={r.playerId} className="rounded-2xl border border-zinc-200 p-4">
              <View className="mb-2 flex-row items-center gap-2">
                <View className="h-6 w-6 items-center justify-center rounded-full bg-zinc-100">
                  <Text className="text-[10px] font-semibold text-zinc-600">{r.dorsal ?? '—'}</Text>
                </View>
                <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]">
                  {[r.firstName, r.lastName].filter(Boolean).join(' ')}
                </Text>
                <Text className="text-xs text-zinc-400">
                  {r.started ? t('stats.starter') : t('stats.sub')}
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-3">
                <Stat label={t('stats.minutes')} value={r.minutesPlayed} />
                <Stat label={t('stats.goals')} value={r.goals} />
                <Stat label={t('stats.assists')} value={r.assists} />
                <Stat label={t('stats.shots')} value={r.shots} />
                <Stat label={t('stats.yellow')} value={r.yellowCards} />
                <Stat label={t('stats.red')} value={r.redCards} />
                <Stat label={t('stats.fouls_committed')} value={r.foulsCommitted} />
                <Stat label={t('stats.fouls_received')} value={r.foulsReceived} />
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View className="min-w-[64px] rounded-xl bg-zinc-50 px-3 py-2">
      <Text className="text-lg font-bold text-[#0F1B2E]">{value}</Text>
      <Text className="text-[10px] text-zinc-400">{label}</Text>
    </View>
  );
}
