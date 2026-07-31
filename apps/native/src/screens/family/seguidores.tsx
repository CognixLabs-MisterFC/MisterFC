import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import {
  getPlayerSpectatorsFromClient,
  removeSpectatorFromClient,
  playerScopedCacheKey,
  type PlayerSpectator,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { ChildSelector } from '@/ui/child-selector';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { t } from '@/i18n';

/**
 * O2-5 C1 — Seguidores del HIJO ACTIVO: listar + revocar (LISTAR/REVOCAR; invitar
 * es server-only por el email → botón "próximamente"). Revocar estrena el
 * write-guard: sin red, deshabilitado con aviso. Caché PLAYER-SCOPED
 * (seguidores::clubId::playerId) → cambiar de hijo NO sirve la lista del anterior.
 */
export function SeguidoresScreen() {
  const { activeClub } = useApp();
  const { activePlayer } = useActivePlayer();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  const { data, fromCache, loading, refresh } = useCached<PlayerSpectator[]>(
    playerScopedCacheKey('seguidores', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getPlayerSpectatorsFromClient(sb, playerId) : Promise.resolve([])),
  );

  const onRevoke = useCallback(
    async (spectatorProfileId: string) => {
      if (!online || !playerId) return; // write-guard
      setBusy(spectatorProfileId);
      const res = await removeSpectatorFromClient(supabase, playerId, spectatorProfileId);
      setBusy(null);
      if ('ok' in res) refresh();
    },
    [online, playerId, refresh],
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={fromCache} />
      <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
        <Text className="text-xl font-semibold text-[#0F1B2E]">{t('seguidores.title')}</Text>
        <View className="rounded-full bg-zinc-100 px-3 py-1.5" style={{ opacity: 0.6 }}>
          <Text className="text-xs font-medium text-zinc-500">{t('seguidores.invite_soon')}</Text>
        </View>
      </View>
      {!online ? (
        <View className="bg-zinc-100 px-4 py-2">
          <Text className="text-center text-xs text-zinc-500">{t('seguidores.offline_write')}</Text>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState message={t('seguidores.empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.spectator_profile_id}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => (
            <View className="mx-4 my-1 flex-row items-center justify-between rounded-xl border border-zinc-200 px-4 py-3">
              <View className="min-w-0 flex-1 pr-2">
                <Text className="text-base font-medium text-[#0F1B2E]" numberOfLines={1}>
                  {item.full_name?.trim() || item.email || t('seguidores.unknown')}
                </Text>
                {item.email ? (
                  <Text className="text-xs text-zinc-400" numberOfLines={1}>{item.email}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => onRevoke(item.spectator_profile_id)}
                disabled={!online || busy === item.spectator_profile_id}
                className="rounded-full border border-red-200 px-3 py-1.5 active:opacity-60"
                style={!online ? { opacity: 0.5 } : undefined}
              >
                <Text className="text-xs font-medium text-red-600">{t('seguidores.revoke')}</Text>
              </Pressable>
            </View>
          )}
        />
      )}
      <Text className="px-4 py-3 text-xs text-zinc-400">{t('seguidores.hint')}</Text>
    </View>
  );
}
