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

type T = (key: string, values?: Record<string, string>) => string;

/**
 * Fecha y hora de un evento con nombres de MES del CATÁLOGO (es/en/va), no
 * `toLocaleString` del sistema: la app no usa el idioma del dispositivo. Ancla en el
 * mismo formato de fecha de la lista de invitaciones (día + mes + año) y le añade la
 * hora con la convención de la app (`toLocaleTimeString` HH:MM, igual que calendario/
 * agenda; solo el HH:MM numérico es locale-agnóstico). El AÑO importa aquí: las colas
 * llegan a +60d / -72h y pueden cruzar cambio de año. → "12 agosto 2026 · 14:30".
 */
function formatEventDateTime(t: T, iso: string): string {
  const d = new Date(iso);
  const date = `${d.getDate()} ${t(`calendario.date.month.${d.getMonth()}`)} ${d.getFullYear()}`;
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

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
                {formatEventDateTime(t, item.starts_at)}
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
