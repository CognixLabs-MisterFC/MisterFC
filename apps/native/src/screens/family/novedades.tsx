import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import {
  getNotificationsPageFromClient,
  markAllNotificationsReadFromClient,
  markNotificationReadFromClient,
  type NotificationFeedRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { fetchCached } from '@/data/client-data';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-5 B1 — Novedades: feed in_app paginado por-usuario (RLS select-own). Página 1
 * con caché offline; "cargar más" trae páginas siguientes (online). Marca leído
 * por-ítem al tocar y "todas". Feed por-usuario → key sin clubId.
 */
export function NovedadesScreen() {
  const t = useTranslations('');
  const [rows, setRows] = useState<NotificationFeedRow[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const loadPage = useCallback(async (p: number) => {
    const r = await fetchCached(`novedades::p${p}`, (sb) =>
      getNotificationsPageFromClient(sb, p),
    );
    if (r.data) {
      const data = r.data;
      setRows((prev) => (p === 1 ? data.rows : [...prev, ...data.rows]));
      setTotal(data.total);
    }
    setOffline(r.fromCache);
    setPage(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await fetchCached('novedades::p1', (sb) =>
        getNotificationsPageFromClient(sb, 1),
      );
      if (!active) return;
      if (r.data) {
        setRows(r.data.rows);
        setTotal(r.data.total);
      }
      setOffline(r.fromCache);
      setPage(1);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const onMarkAll = useCallback(async () => {
    await markAllNotificationsReadFromClient(supabase);
    await loadPage(1);
  }, [loadPage]);

  const onOpen = useCallback(async (id: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'sent' } : r)),
    );
    await markNotificationReadFromClient(supabase, id);
  }, []);

  if (loading) return <LoadingScreen />;
  if (rows.length === 0) return <EmptyState message={t('novedades.empty')} />;

  const hasMore = rows.length < total;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={offline} />
      <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
        <Text className="text-xl font-semibold text-[#0F1B2E]">
          {t('nav.novedades')}
        </Text>
        <Pressable onPress={onMarkAll} className="active:opacity-60">
          <Text className="text-xs font-medium text-emerald-600">
            {t('novedades.mark_all')}
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item.id)}
            className="flex-row items-start gap-3 border-b border-zinc-100 px-4 py-3 active:bg-zinc-50"
          >
            <View
              className={`mt-1.5 h-2 w-2 rounded-full ${item.status === 'pending' ? 'bg-emerald-500' : 'bg-transparent'}`}
            />
            <View className="flex-1">
              <Text className="text-sm text-[#0F1B2E]">{item.type}</Text>
              <Text className="text-xs text-zinc-400">
                {item.created_at.slice(0, 10)}
              </Text>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          hasMore ? (
            <Pressable
              onPress={() => loadPage(page + 1)}
              className="items-center py-4 active:opacity-60"
            >
              <Text className="text-sm font-medium text-[#0F1B2E]">
                {t('novedades.load_more')}
              </Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}
