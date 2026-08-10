import { useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getWeekMatchesFromClient,
  eventScopedCacheKey,
  type WeekMatch,
} from '@misterfc/core';
import { useSpectatorPlayer } from '@/auth/spectator-player';
import { useCached } from '@/data/use-cached';
import { SpectatorPlayerSelector } from '@/ui/spectator-player-selector';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/** Polling de marcadores en vivo (ms). Online refresca en vivo; offline sirve caché. */
const LIVE_POLL_MS = 15_000;

/**
 * O2-6 — Directos del SEGUIDOR: listado de la semana del EQUIPO del jugador seguido
 * (con polling en vivo; offline muestra el último listado, marcado "sin conexión").
 * Reutiliza `getWeekMatchesFromClient` con el filtro `teamId` del seguido. SIN la
 * pestaña "seguir equipos" (eso es escritura de familia; el seguidor solo mira).
 * Caché player-scoped (spec-directos::${playerId}).
 */
export function SpectatorDirectosScreen() {
  const t = useTranslations('');
  const { activePlayer } = useSpectatorPlayer();
  const clubId = activePlayer?.clubId ?? null;
  const teamId = activePlayer?.teamId ?? null;
  const playerId = activePlayer?.playerId ?? null;

  const { data, fromCache, loading, refresh } = useCached<WeekMatch[]>(
    eventScopedCacheKey('spec-directos', playerId ?? 'none'),
    (sb) =>
      clubId && teamId
        ? getWeekMatchesFromClient(sb, clubId, { teamId })
        : Promise.resolve([]),
  );

  // Polling: online → refetch en vivo (y cachea el último estado); offline → caché.
  useEffect(() => {
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (!playerId) return <EmptyState message={t('spectator.no_player')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <SpectatorPlayerSelector />
      <OfflineBanner show={fromCache} />
      {rows.length === 0 ? (
        <EmptyState message={t('directos.empty_live')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(m) => m.eventId}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => <MatchCard match={item} />}
        />
      )}
    </View>
  );
}

function MatchCard({ match }: { match: WeekMatch }) {
  const t = useTranslations('');
  const router = useRouter();
  const statusLabel =
    match.status === 'live'
      ? t('directos.status_live')
      : match.status === 'closed'
        ? t('directos.status_closed')
        : t('directos.status_scheduled');
  const score =
    match.goalsOwn == null
      ? match.startsAt.slice(11, 16)
      : `${match.goalsOwn} - ${match.goalsRival}`;
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/spectator/directo', params: { eventId: match.eventId } })
      }
      className="mx-4 my-1.5 rounded-2xl border border-zinc-200 p-4 active:bg-zinc-50"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: match.teamColor || BRAND.navy }} />
          <Text className="text-xs text-zinc-400">{match.categoryName}</Text>
        </View>
        <Text className={`text-xs font-semibold ${match.status === 'live' ? 'text-red-500' : 'text-zinc-400'}`}>
          {statusLabel}
        </Text>
      </View>
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="flex-1 text-base font-semibold text-[#0F1B2E]" numberOfLines={1}>
          {match.teamName}
          {match.opponentName ? `  ${t('common.vs')}  ${match.opponentName}` : ''}
        </Text>
        <Text className="text-lg font-bold text-[#0F1B2E]">{score}</Text>
      </View>
    </Pressable>
  );
}
