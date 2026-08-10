import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  clubScopedCacheKey,
  getRecentTrainingsFromClient,
  type Role,
  type StaffTrainingEvent,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-7a — Lista de sesiones para PASAR LISTA (staff, SOLO LECTURA aquí). Entrena-
 * mientos recientes del scope del user (todos sus equipos), cada fila con equipo,
 * fecha y conteo marcados/roster. Tap → pantalla de marcado (?eventId). El EQUIPO
 * lo fija la sesión elegida, así que NO hace falta un selector de equipo. Fetch en
 * core (`getRecentTrainingsFromClient`). Caché club-scoped (id en la key).
 */
export function AsistenciaListScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { user } = useSession();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const role = (activeClub?.role ?? null) as Role | null;
  const userId = user?.id ?? null;
  const accent = theme?.color ?? '#0F1B2E';

  const { data, fromCache, loading } = useCached<StaffTrainingEvent[]>(
    clubScopedCacheKey('asistencia-list', clubId ?? 'none'),
    (sb) =>
      clubId && role
        ? getRecentTrainingsFromClient(sb, {
            clubId,
            role,
            userId,
            rangeDays: 30,
          })
        : Promise.resolve([]),
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <Text className="px-4 pb-2 pt-4 text-xl font-semibold text-[#0F1B2E]">
        {t('asistencia_staff.title')}
      </Text>
      {rows.length === 0 ? (
        <EmptyState message={t('asistencia_staff.list_empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/staff/asistencia-sesion',
                  params: { eventId: item.id },
                })
              }
              className="mx-4 my-1 flex-row items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 active:opacity-70"
            >
              <View
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: item.team_color }}
              />
              <View className="min-w-0 flex-1">
                <Text
                  className="text-sm font-medium text-[#0F1B2E]"
                  numberOfLines={1}
                >
                  {item.team_name}
                </Text>
                <Text className="text-xs text-zinc-400" numberOfLines={1}>
                  {[
                    new Date(item.starts_at).toLocaleString(),
                    item.category_name,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Text
                className="text-xs font-semibold"
                style={{ color: accent }}
              >
                {t('asistencia_staff.marked_count', {
                  marked: String(item.marked_count),
                  total: String(item.roster_count),
                })}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
