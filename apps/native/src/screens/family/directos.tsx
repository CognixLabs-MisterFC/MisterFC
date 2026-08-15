import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getWeekMatchesFromClient,
  getFollowableTeamsFromClient,
  setTeamFollowFromClient,
  clubScopedCacheKey,
  type WeekMatch,
  type FollowableTeam,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/** Polling de marcadores en vivo (ms). Online refresca en vivo; offline sirve caché. */
const LIVE_POLL_MS = 15_000;

/**
 * O2-5 B1 — Directos: LISTADO de la semana (con polling en vivo cuando hay red;
 * offline muestra el último listado conocido, marcado "sin conexión") + SEGUIR
 * equipos (toggle con write-guard: sin red, deshabilitado). El DETALLE del
 * directo es B2.
 */
export function DirectosScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const [tab, setTab] = useState<'live' | 'follow'>('live');

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row border-b border-zinc-100">
        <TabButton label={t('directos.tab_live')} active={tab === 'live'} onPress={() => setTab('live')} />
        <TabButton label={t('directos.follow.follow')} active={tab === 'follow'} onPress={() => setTab('follow')} />
      </View>
      {tab === 'live' ? (
        <LiveList clubId={clubId} />
      ) : (
        <FollowList clubId={clubId} />
      )}
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 items-center py-3 active:opacity-70">
      <Text className={active ? 'text-sm font-semibold text-[#0F1B2E]' : 'text-sm text-zinc-400'}>
        {label}
      </Text>
      {active ? <View className="mt-2 h-0.5 w-10 rounded-full bg-[#0F1B2E]" /> : null}
    </Pressable>
  );
}

function LiveList({ clubId }: { clubId: string | null }) {
  const t = useTranslations('');
  const { data, fromCache, loading, refresh } = useCached<WeekMatch[]>(
    clubScopedCacheKey('directos', clubId ?? 'none'),
    (sb) => (clubId ? getWeekMatchesFromClient(sb, clubId) : Promise.resolve([])),
  );

  // Polling: online → refetch en vivo (y cachea el último estado); offline → el
  // fetchCached devuelve caché. Un marcador que cambia no se sirve stale online.
  useEffect(() => {
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState message={t('directos.empty_live')} />;

  return (
    <View className="flex-1">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(m) => m.eventId}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item }) => <MatchCard match={item} />}
      />
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
        router.push({ pathname: '/family/directo', params: { eventId: match.eventId } })
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

function FollowList({ clubId }: { clubId: string | null }) {
  const t = useTranslations('');
  const online = useIsOnline();
  const { data, fromCache, loading, refresh } = useCached<FollowableTeam[]>(
    clubScopedCacheKey('directos-follow', clubId ?? 'none'),
    (sb) => (clubId ? getFollowableTeamsFromClient(sb, clubId) : Promise.resolve([])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const onToggle = useCallback(
    async (team: FollowableTeam) => {
      if (!online) return; // write-guard: sin red no se muta
      setBusy(team.teamId);
      const res = await setTeamFollowFromClient(supabase, team.teamId, !team.following);
      setBusy(null);
      if ('ok' in res) {
        refresh();
        void invalidateAfterWrite('setTeamFollow');
      }
    },
    [online, refresh],
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState message={t('directos.empty_follow')} />;

  return (
    <View className="flex-1">
      <OfflineBanner show={fromCache} />
      {!online ? (
        <View className="bg-zinc-100 px-4 py-2">
          <Text className="text-center text-xs text-zinc-500">{t('directos.offline_write')}</Text>
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.teamId}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item }) => (
          <View className="mx-4 my-1 flex-row items-center justify-between rounded-xl border border-zinc-200 px-4 py-3">
            <View className="flex-row items-center gap-2">
              <View className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color || BRAND.navy }} />
              <View>
                <Text className="text-base font-medium text-[#0F1B2E]">{item.name}</Text>
                <Text className="text-xs text-zinc-400">{item.categoryName}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => onToggle(item)}
              disabled={!online || busy === item.teamId}
              className={`rounded-full px-3 py-1.5 ${item.following ? 'bg-[#0F1B2E]' : 'border border-zinc-300'}`}
              style={!online ? { opacity: 0.5 } : undefined}
            >
              <Text className={item.following ? 'text-xs font-medium text-white' : 'text-xs font-medium text-zinc-600'}>
                {item.following ? t('directos.follow.following') : t('directos.follow.follow')}
              </Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
