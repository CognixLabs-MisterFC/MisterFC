import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  getUpcomingEventsFromClient,
  getStaffCallupsFromClient,
  clubScopedCacheKey,
  type UpcomingEvent,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { staffEventTarget } from '@/notifications/feed-target';
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
  other: '📌',
};

/** "Viernes, 21 de agosto · 18:00" — fecha (primera letra en mayúscula) + hora.
 * Mismo helper que el inicio del jugador (#489). */
function formatEventWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${time}`;
}

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

  // E1 — próximo evento = el MÁS CERCANO de CUALQUIERA de sus equipos (la RLS de
  // getUpcomingEventsFromClient ya acota a sus equipos y ordena por fecha), con su
  // equipo indicado. Destino = staffEventTarget (#478).
  const nextEvent = home.upcoming[0] ?? null;
  const nextEventTarget = nextEvent ? staffEventTarget(nextEvent) : null;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <ScreenTitle>{t('staff_home.title')}</ScreenTitle>

        {/* E1 — tarjeta ANCHA del próximo evento, arriba. MISMO diseño que el inicio
            del jugador (#480 + #489): icono + tipo/título en grande, fecha·hora en
            tamaño medio, equipo pequeño. Clicable. Sustituye a la antigua lista
            "Próximos eventos" (eliminada abajo). */}
        <Pressable
          onPress={nextEventTarget ? () => router.push(nextEventTarget as Href) : undefined}
          disabled={!nextEventTarget}
          className="rounded-2xl border border-zinc-200 p-4 active:opacity-70"
          style={{ borderLeftWidth: 4, borderLeftColor: accent }}
        >
          <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('inicio.next_event')}
          </Text>
          {nextEvent ? (
            (() => {
              // Sin duplicar: el tipo (catálogo compartido) es el titular. Si el
              // evento trae título propio DISTINTO del tipo (p. ej. un amistoso
              // "Fonteta vs Amistat"), ese título sustituye al tipo como titular.
              const typeLabel = t(`calendario.types.${nextEvent.type}`);
              const ownTitle = nextEvent.title?.trim();
              const headline = ownTitle && ownTitle !== typeLabel ? ownTitle : typeLabel;
              return (
                <>
                  <View className="mt-1 flex-row items-center gap-2">
                    <Text className="text-2xl">{TYPE_ICON[nextEvent.type] ?? '📌'}</Text>
                    <Text
                      className="flex-1 text-xl font-extrabold uppercase text-[#0F1B2E]"
                      numberOfLines={2}
                    >
                      {headline}
                    </Text>
                  </View>
                  <Text className="mt-2 text-base font-semibold text-[#0F1B2E] tabular-nums">
                    {formatEventWhen(nextEvent.starts_at)}
                  </Text>
                  {nextEvent.teamName ? (
                    <Text className="text-sm text-zinc-500">{nextEvent.teamName}</Text>
                  ) : null}
                </>
              );
            })()
          ) : (
            <Text className="mt-1 text-sm text-zinc-400">{t('inicio.empty_upcoming')}</Text>
          )}
        </Pressable>

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
      </ScrollView>
    </View>
  );
}
