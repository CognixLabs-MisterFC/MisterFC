import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getUpcomingEventsFromClient,
  getStaffCallupsFromClient,
  clubScopedCacheKey,
  type UpcomingEvent,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { ListCard, Tile, CountBadge } from './hub-parts';

/**
 * O2-10a — INICIO del cuerpo técnico. Bloques de TAREA (sin comunicación — mensajes/
 * anuncios/novedades son 10b): "convocatorias sin publicar" (`getStaffCallupsFromClient`
 * → filtra no publicadas) y "próximos eventos" (`getUpcomingEventsFromClient`, RLS
 * scope = sus equipos), más accesos rápidos al hub. Solo lectura, cache-first
 * (`staff-home.${clubId}`).
 */
const DAY = 86_400_000;

type HomeData = { upcoming: UpcomingEvent[]; unpublishedCallups: number };

const TYPE_ICON: Record<string, string> = {
  training: '🏋️',
  match: '⚽',
  friendly: '⚽',
  tournament: '🏆',
};

export function StaffHomeScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { user } = useSession();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const role = activeClub?.role ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<HomeData>(
    clubScopedCacheKey('staff-home', clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !role) return { upcoming: [], unpublishedCallups: 0 };
      const now = Date.now();
      const upcoming = await getUpcomingEventsFromClient(
        sb,
        new Date(now).toISOString(),
        new Date(now + 7 * DAY).toISOString(),
        5,
      );
      const callups = await getStaffCallupsFromClient(sb, {
        clubId,
        role,
        userId: user?.id ?? null,
        rangeDays: 30,
      });
      const unpublishedCallups = callups.filter((c) => !c.published).length;
      return { upcoming, unpublishedCallups };
    },
  );

  const go = (pathname: string) => router.push(pathname);

  if (loading) return <LoadingScreen />;
  const home = data ?? { upcoming: [], unpublishedCallups: 0 };

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <ScreenTitle>{t('staff_home.title')}</ScreenTitle>

        {/* Tarea: convocatorias sin publicar. */}
        {home.unpublishedCallups > 0 ? (
          <ListCard accent="#dc2626" onPress={() => go('/staff/convocatorias')}>
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]">
                {t('staff_home.unpublished_callups')}
              </Text>
              <CountBadge count={home.unpublishedCallups} accent="#dc2626" />
            </View>
          </ListCard>
        ) : null}

        {/* Accesos rápidos. */}
        <View className="flex-row flex-wrap gap-2">
          <Tile icon="👥" label={t('staff_home.tile_teams')} accent={accent} onPress={() => go('/staff/mis-equipos')} />
          <Tile icon="📅" label={t('staff_home.tile_calendar')} accent={accent} onPress={() => go('/staff/calendario')} />
          <Tile icon="📋" label={t('staff_home.tile_callups')} accent={accent} onPress={() => go('/staff/convocatorias')} />
          <Tile icon="✅" label={t('staff_home.tile_attendance')} accent={accent} onPress={() => go('/staff/asistencia')} />
          <Tile icon="🔴" label={t('staff_home.tile_directos')} accent={accent} onPress={() => go('/staff/directos')} />
          <Tile icon="🏋️" label={t('staff_home.tile_today_training')} accent={accent} onPress={() => go('/staff/sesion-del-dia')} />
        </View>

        {/* Próximos eventos. */}
        <View style={{ gap: 8 }}>
          <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('staff_home.upcoming')}
          </Text>
          {home.upcoming.length === 0 ? (
            <EmptyState message={t('staff_home.no_upcoming')} />
          ) : (
            home.upcoming.map((ev) => (
              <ListCard key={ev.id} accent={accent}>
                <View className="flex-row items-center gap-2">
                  <Text className="text-base">{TYPE_ICON[ev.type] ?? '📌'}</Text>
                  <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                    {ev.title}
                  </Text>
                </View>
                <Text className="mt-0.5 text-xs text-zinc-400">
                  {new Date(ev.starts_at).toLocaleString()}
                  {ev.teamName ? ` · ${ev.teamName}` : ''}
                </Text>
              </ListCard>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
