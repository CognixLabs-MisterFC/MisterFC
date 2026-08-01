import { ScrollView, Text, View } from 'react-native';
import {
  getClosedTeamMatchesFromClient,
  getFamilyMatchStatRowsFromClient,
  eventScopedCacheKey,
  type ClosedTeamMatch,
  type FamilyMatchStatRow,
} from '@misterfc/core';
import { useSpectatorPlayer } from '@/auth/spectator-player';
import { useCached } from '@/data/use-cached';
import { SpectatorPlayerSelector } from '@/ui/spectator-player-selector';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';

type MatchStatItem = { match: ClosedTeamMatch; row: FamilyMatchStatRow | null };

/**
 * O2-6 — Estadísticas del SEGUIDOR (opción A, MÁS restrictiva que la web): lista de
 * los partidos cerrados del equipo del jugador seguido, y en cada uno SOLO la fila
 * del jugador seguido (`getFamilyMatchStatRowsFromClient` filtrado a `[playerId]`).
 * NUNCA el agregado de equipo (todos los jugadores): un seguidor de UN niño no ve el
 * rendimiento del resto. El nombre sale del jugador activo (el seguidor no lee
 * `players`). Caché player-scoped (spec-stats::${playerId}).
 */
export function SpectatorEstadisticasScreen() {
  const { activePlayer } = useSpectatorPlayer();
  const teamId = activePlayer?.teamId ?? null;
  const playerId = activePlayer?.playerId ?? null;

  const { data, fromCache, loading } = useCached<MatchStatItem[]>(
    eventScopedCacheKey('spec-stats', playerId ?? 'none'),
    async (sb) => {
      if (!teamId || !playerId) return [];
      const matches = await getClosedTeamMatchesFromClient(sb, teamId);
      return Promise.all(
        matches.map(async (match) => {
          const rows = await getFamilyMatchStatRowsFromClient(sb, match.eventId, [playerId]);
          return { match, row: rows[0] ?? null };
        }),
      );
    },
  );

  if (!playerId) return <EmptyState message={t('spectator.no_player')} />;
  if (loading) return <LoadingScreen />;
  const items = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <SpectatorPlayerSelector />
      <OfflineBanner show={fromCache} />
      {items.length === 0 ? (
        <EmptyState message={t('spectator.stats_empty')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          <ScreenTitle>{t('spectator.stats_title', { name: activePlayer?.fullName ?? '' })}</ScreenTitle>
          {items.map(({ match, row }) => (
            <MatchStatCard key={match.eventId} match={match} row={row} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function MatchStatCard({ match, row }: MatchStatItem) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
          {match.teamName}
          {match.opponentName ? `  ${t('common.vs')}  ${match.opponentName}` : ''}
        </Text>
        <Text className="text-base font-bold text-[#0F1B2E] tabular-nums">
          {match.goalsOwn} - {match.goalsRival}
        </Text>
      </View>
      <Text className="mt-0.5 text-xs text-zinc-400">
        {[new Date(match.startsAt).toLocaleDateString(), match.categoryName].filter(Boolean).join(' · ')}
      </Text>

      {row ? (
        <>
          <View className="mt-2 flex-row items-center gap-2">
            <Text className="text-xs text-zinc-400">
              {row.started ? t('stats.starter') : t('stats.sub')}
            </Text>
          </View>
          <View className="mt-2 flex-row flex-wrap gap-2">
            <Stat label={t('stats.minutes')} value={row.minutesPlayed} />
            <Stat label={t('stats.goals')} value={row.goals} />
            <Stat label={t('stats.assists')} value={row.assists} />
            <Stat label={t('stats.shots')} value={row.shots} />
            <Stat label={t('stats.yellow')} value={row.yellowCards} />
            <Stat label={t('stats.red')} value={row.redCards} />
            <Stat label={t('stats.fouls_committed')} value={row.foulsCommitted} />
            <Stat label={t('stats.fouls_received')} value={row.foulsReceived} />
          </View>
        </>
      ) : (
        <Text className="mt-2 text-sm text-zinc-400">{t('spectator.stats_did_not_play')}</Text>
      )}
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
