import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { clubScopedCacheKey, type DireccionPendingEvent } from '@misterfc/core';
import type { NativeDbClient } from '@/data/client-data';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { directionEventTarget } from '@/notifications/feed-target';

/**
 * D2-1 — Pantalla-lista GENÉRICA de una cola de eventos pendientes del inicio de
 * dirección (SOLO CONSULTA, club-wide). La comparten las tres colas de eventos
 * (entrenos sin sesión, convocatorias sin publicar, entrenos sin asistencia): cada
 * ruta le pasa su `loader` de core, su `titleKey` y su namespace de caché. El destino
 * de cada fila lo decide `directionEventTarget` (partido→convocatoria; entreno con
 * sesión→visor de sesión; sin sesión→detalle de entreno). Ni un botón de acción.
 */
const TYPE_ICON: Record<string, string> = {
  training: '🏋️',
  match: '⚽',
  friendly: '⚽',
  tournament: '🏆',
};

export function DireccionPendingEventsScreen({
  titleKey,
  cacheResource,
  load,
}: {
  titleKey: string;
  cacheResource: string;
  load: (sb: NativeDbClient, clubId: string) => Promise<DireccionPendingEvent[]>;
}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<DireccionPendingEvent[]>(
    clubScopedCacheKey(cacheResource, clubId ?? 'none'),
    (sb) => (clubId ? load(sb, clubId) : Promise.resolve([])),
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
        ListHeaderComponent={<ScreenTitle>{t(titleKey)}</ScreenTitle>}
        ListEmptyComponent={<EmptyState message={t('dir_inicio.list_empty')} />}
        renderItem={({ item }) => {
          const target = directionEventTarget(item);
          const onPress = target ? () => router.push(target as Href) : undefined;
          const rival = item.opponent_name?.trim() || null;
          const detail = [rival, item.team_name].filter(Boolean).join(' · ');
          return (
            <Pressable
              disabled={!onPress}
              onPress={onPress}
              className={`rounded-2xl border border-zinc-200 p-4 ${onPress ? 'active:opacity-70' : ''}`}
              style={{ borderLeftWidth: 4, borderLeftColor: item.team_color ?? accent }}
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-lg">{TYPE_ICON[item.type] ?? '📌'}</Text>
                <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
                  {item.title || t(`calendario.types.${item.type}`)}
                </Text>
                {onPress ? <Text className="text-zinc-300">›</Text> : null}
              </View>
              <Text className="mt-1 text-xs text-zinc-500">
                {new Date(item.starts_at).toLocaleString()}
              </Text>
              {detail ? (
                <Text className="text-xs text-zinc-400" numberOfLines={1}>
                  {detail}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
