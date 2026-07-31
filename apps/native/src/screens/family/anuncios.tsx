import { useEffect } from 'react';
import { FlatList, Text, View } from 'react-native';
import {
  getAnnouncementsListFromClient,
  markNotificationsReadFromClient,
  clubScopedCacheKey,
  type AnnouncementRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { t } from '@/i18n';

/**
 * O2-5 B1 — Anuncios: lista club-wide + equipos del hijo (RLS). Caché club-scoped
 * (clubId en la key). Marca leídos los `new_announcement` al abrir.
 */
export function AnunciosScreen() {
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<AnnouncementRow[]>(
    clubScopedCacheKey('anuncios', clubId ?? 'none'),
    (sb) =>
      clubId ? getAnnouncementsListFromClient(sb, clubId) : Promise.resolve([]),
  );

  useEffect(() => {
    void markNotificationsReadFromClient(supabase, [
      'new_announcement',
    ] as ('new_announcement')[]);
  }, []);

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState message={t('anuncios.empty')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View className="border-b border-zinc-100 px-4 py-3">
            <View className="flex-row items-center gap-2">
              {item.pinned ? <Text className="text-amber-500">📌</Text> : null}
              <Text className="flex-1 text-base font-semibold text-[#0F1B2E]">
                {item.title}
              </Text>
            </View>
            <Text className="mt-1 text-sm text-zinc-600" numberOfLines={3}>
              {item.body}
            </Text>
            <Text className="mt-1 text-xs text-zinc-400">
              {(item.teamName ?? t('nav.anuncios')) + ' · ' + item.created_at.slice(0, 10)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
