import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  getUpcomingEventsFromClient,
  getStaffCallupsFromClient,
  getStaffTeamsFromClient,
  listStaffTrainingsWithoutAttendanceFromClient,
  listStaffTrainingsWithoutSessionFromClient,
  clubScopedCacheKey,
  type UpcomingEvent,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { reportDataError } from '@/lib/report-error';
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

type HomeData = {
  upcoming: UpcomingEvent[];
  /** Tarea 1 — convocatorias sin publicar de partido a < 3 días. */
  unpublishedCallups: number;
  /** Tarea 2 — entrenos pasados (sin límite) sin pasar lista. */
  trainingsWithoutAttendance: number;
  /** Tarea 3 — entrenos a < 24 h sin sesión. */
  trainingsWithoutSession: number;
};

const EMPTY_HOME: HomeData = {
  upcoming: [],
  unpublishedCallups: 0,
  trainingsWithoutAttendance: 0,
  trainingsWithoutSession: 0,
};

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
  const membershipId = activeClub?.membershipId ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<HomeData>(
    clubScopedCacheKey('staff-home', clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !role) return EMPTY_HOME;
      const now = Date.now();
      // Modo Míster: un director/admin en el área staff ve SOLO sus equipos, igual que
      // un entrenador. Resolvemos sus equipos PRIMERO (se reusan en las tareas 2 y 3) y,
      // en modo Míster, acotamos "próximos eventos" a esos equipos ANTES del limit (un
      // filtro en cliente tras el top-5 club-wide dejaría fuera los suyos). Para el
      // entrenador normal (isCoachMode=false) no se pasa teamIds → RLS, sin cambios.
      const isCoachMode = role === 'admin_club' || role === 'director';
      const teams = membershipId
        ? await getStaffTeamsFromClient(sb, { membershipId, clubId }, (e) =>
            reportDataError('staff-home', e),
          )
        : [];
      const teamIds = teams.map((tm) => tm.teamId);
      const upcoming = await getUpcomingEventsFromClient(
        sb,
        new Date(now).toISOString(),
        new Date(now + 7 * DAY).toISOString(),
        5,
        undefined,
        isCoachMode ? teamIds : undefined,
      );
      // Tarea 1 — convocatorias de partido a < 3 días sin publicar. asStaffMember acota
      // al director a sus equipos (para coordinador/entrenador es no-op).
      const callups = await getStaffCallupsFromClient(sb, {
        clubId,
        role,
        userId: user?.id ?? null,
        rangeDays: 3,
        asStaffMember: true,
      });
      const unpublishedCallups = callups.filter((c) => !c.published).length;
      // Tareas 2 y 3 — entrenos pendientes de SUS equipos (mismos teamIds de arriba).
      const [withoutAttendance, withoutSession] = await Promise.all([
        listStaffTrainingsWithoutAttendanceFromClient(sb, { teamIds }),
        listStaffTrainingsWithoutSessionFromClient(sb, { teamIds }),
      ]);
      return {
        upcoming,
        unpublishedCallups,
        trainingsWithoutAttendance: withoutAttendance.length,
        trainingsWithoutSession: withoutSession.length,
      };
    },
  );

  const go = (pathname: string) => router.push(pathname);

  if (loading) return <LoadingScreen />;
  const home = data ?? EMPTY_HOME;

  // E1 — próximo evento = el MÁS CERCANO, con su equipo indicado. Destino =
  // staffEventTarget (#478).
  //
  // OJO — la RLS NO acota esto a sus equipos, aunque aquí se dijera lo contrario:
  // `events_select` abre partidos/amistosos/torneos a TODO el club a propósito
  // (F7B-2), así que sin `teamIds` se cuela el partido de otro equipo. Hoy solo
  // el modo Míster (admin/director) pasa `teamIds`; al entrenador y al
  // coordinador les falta, y por eso pueden ver un partido ajeno. Se arregla
  // aparte, junto con el mismo fallo en la web.
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

        {/* O2-16 — Tres tareas pendientes del entrenador, simétricas: cada una lleva a
            la lista de lo suyo (1→convocatorias, 2→sin pasar lista, 3→sin sesión).
            Criterio D2: SIEMPRE visibles, clicables SOLO con contador > 0 (a 0 quedan
            grises e inertes → nunca pantalla vacía). Reusa ListCard + CountBadge. */}
        {[
          {
            key: 'unpublished_callups',
            count: home.unpublishedCallups,
            href: '/staff/convocatorias',
          },
          {
            key: 'trainings_without_attendance',
            count: home.trainingsWithoutAttendance,
            href: '/staff/entrenos-sin-lista',
          },
          {
            key: 'trainings_without_session',
            count: home.trainingsWithoutSession,
            href: '/staff/entrenos-sin-sesion',
          },
        ].map((task) => {
          const active = task.count > 0;
          return (
            <ListCard
              key={task.key}
              accent={active ? '#dc2626' : '#e4e4e7'}
              onPress={active ? () => go(task.href) : undefined}
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]">
                  {t(`staff_home.${task.key}`)}
                </Text>
                <CountBadge count={task.count} accent={active ? '#dc2626' : '#a1a1aa'} />
              </View>
            </ListCard>
          );
        })}

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
