import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  getUnreadNotificationsFeedFromClient,
  getNotificationsPageFromClient,
  markAllNotificationsReadFromClient,
  markNotificationReadFromClient,
  notificationFeedText,
  type NotificationFeedRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { fetchCached } from '@/data/client-data';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { useApp } from '@/auth/context';
import { familyFeedTarget } from '@/notifications/feed-target';

type Tab = 'unread' | 'all';

/**
 * O2 Bloque A — Novedades. Dos pestañas:
 *  · "Sin leer" (por defecto): las 10 más recientes en `pending`. Al tocar una con
 *    destino → navega Y la marca como leída (= archivar), con lo que sale de la
 *    lista. Las que NO tienen destino (tipos de staff) llevan un botón "marcar
 *    leída" para poder quitarlas.
 *  · "Todas": histórico paginado (leídas incluidas), reutiliza la paginación de
 *    hoy (páginas de 20 + "cargar más").
 * El contador de no leídos (badge) se mantiene coherente vía invalidación tras
 * cada marcado. Feed por-usuario (RLS select-own) → keys sin clubId.
 */
export function NovedadesScreen() {
  const t = useTranslations('');
  const tFeed = useTranslations('home.feed');
  const router = useRouter();
  const { theme } = useApp();
  const accent = theme?.color ?? BRAND.navy;

  const [tab, setTab] = useState<Tab>('unread');

  // Pestaña "Sin leer".
  const [unread, setUnread] = useState<NotificationFeedRow[]>([]);
  const [unreadLoading, setUnreadLoading] = useState(true);

  // Pestaña "Todas" (paginada).
  const [all, setAll] = useState<NotificationFeedRow[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [allLoaded, setAllLoaded] = useState(false);

  const [offline, setOffline] = useState(false);

  // Carga inicial de "Sin leer" (IIFE + guard: el setState va tras el await, no
  // síncrono en el efecto — patrón exigido por el React Compiler del repo).
  useEffect(() => {
    let active = true;
    (async () => {
      const r = await fetchCached('novedades.unread', (sb) =>
        getUnreadNotificationsFeedFromClient(sb),
      );
      if (!active) return;
      if (r.data) setUnread(r.data);
      setOffline(r.fromCache);
      setUnreadLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Histórico paginado ("Todas"). Se dispara desde el onPress de la pestaña y del
  // botón "cargar más" (event handlers → setState permitido, no en efecto).
  const loadAllPage = useCallback(async (p: number) => {
    const r = await fetchCached(`novedades.p${p}`, (sb) =>
      getNotificationsPageFromClient(sb, p),
    );
    if (r.data) {
      const d = r.data;
      setAll((prev) => (p === 1 ? d.rows : [...prev, ...d.rows]));
      setTotal(d.total);
    }
    setOffline(r.fromCache);
    setPage(p);
    setAllLoaded(true);
  }, []);

  // Carga perezosa del histórico la primera vez que se abre la pestaña "Todas".
  const openAllTab = useCallback(() => {
    setTab('all');
    if (!allLoaded) void loadAllPage(1);
  }, [allLoaded, loadAllPage]);

  /** Marca una como leída (pending→sent): fuera de "Sin leer", "sent" en "Todas". */
  const markRead = useCallback(async (id: string) => {
    setUnread((prev) => prev.filter((r) => r.id !== id));
    setAll((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'sent' } : r)));
    await markNotificationReadFromClient(supabase, id);
    void invalidateAfterWrite('markNotifications');
  }, []);

  /** Toca una fila con destino: marca leída (si pendiente) y navega a su sitio. */
  const openRow = useCallback(
    (row: NotificationFeedRow) => {
      const target = familyFeedTarget(row.type, row.payload);
      if (row.status === 'pending') void markRead(row.id);
      if (target) router.push(target as Href);
    },
    [markRead, router],
  );

  const onMarkAll = useCallback(async () => {
    setUnread([]);
    setAll((prev) => prev.map((r) => ({ ...r, status: 'sent' })));
    await markAllNotificationsReadFromClient(supabase);
    void invalidateAfterWrite('markNotifications');
  }, []);

  if (unreadLoading) return <LoadingScreen />;

  const rows = tab === 'unread' ? unread : all;
  const hasMore = tab === 'all' && all.length < total;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={offline} />

      {/* Cabecera: título + "marcar todas". */}
      <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
        <Text className="text-xl font-semibold text-[#0F1B2E]">{t('nav.novedades')}</Text>
        {unread.length > 0 ? (
          <Pressable onPress={onMarkAll} className="active:opacity-60">
            <Text className="text-xs font-medium text-emerald-600">{t('novedades.mark_all')}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Pestañas: Sin leer / Todas. */}
      <View className="flex-row gap-2 px-4 pb-2 pt-1">
        <TabChip label={t('novedades.tab_unread')} on={tab === 'unread'} accent={accent} onPress={() => setTab('unread')} />
        <TabChip label={t('novedades.tab_all')} on={tab === 'all'} accent={accent} onPress={openAllTab} />
      </View>

      {rows.length === 0 ? (
        <EmptyState message={tab === 'unread' ? t('novedades.empty_unread') : t('novedades.empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => {
            const clickable = familyFeedTarget(item.type, item.payload) != null;
            const pending = item.status === 'pending';
            const body = (
              <>
                <View className={`mt-1.5 h-2 w-2 rounded-full ${pending ? 'bg-emerald-500' : 'bg-transparent'}`} />
                <View className="flex-1">
                  <Text className="text-sm text-[#0F1B2E]">
                    {notificationFeedText(tFeed, item.type, item.payload)}
                  </Text>
                  <Text className="text-xs text-zinc-400">{item.created_at.slice(0, 10)}</Text>
                </View>
                {/* Sin destino + pendiente → botón para quitarla (marcar leída). */}
                {!clickable && pending ? (
                  <Pressable
                    onPress={() => void markRead(item.id)}
                    hitSlop={8}
                    className="ml-2 rounded-full border border-zinc-200 px-2 py-1 active:opacity-60"
                  >
                    <Text className="text-[11px] font-medium text-zinc-500">{t('novedades.mark_read')}</Text>
                  </Pressable>
                ) : null}
              </>
            );
            return clickable ? (
              <Pressable
                onPress={() => openRow(item)}
                className="flex-row items-start gap-3 border-b border-zinc-100 px-4 py-3 active:bg-zinc-50"
              >
                {body}
              </Pressable>
            ) : (
              <View className="flex-row items-start gap-3 border-b border-zinc-100 px-4 py-3">{body}</View>
            );
          }}
          ListFooterComponent={
            hasMore ? (
              <Pressable
                onPress={() => void loadAllPage(page + 1)}
                className="items-center py-4 active:opacity-60"
              >
                <Text className="text-sm font-medium text-[#0F1B2E]">{t('novedades.load_more')}</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}

function TabChip({
  label,
  on,
  accent,
  onPress,
}: {
  label: string;
  on: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
      style={on ? { backgroundColor: accent } : undefined}
    >
      <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>{label}</Text>
    </Pressable>
  );
}
