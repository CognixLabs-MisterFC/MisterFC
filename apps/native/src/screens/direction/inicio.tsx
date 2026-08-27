import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  getDireccionHomeCountsFromClient,
  getUnreadNotificationsFeedFromClient,
  markNotificationReadFromClient,
  notificationFeedText,
  clubScopedCacheKey,
  type DireccionHomeCounts,
  type NotificationFeedRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { directionFeedTarget } from '@/notifications/feed-target';
import { OfflineBanner, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { CountBadge } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/** Nº de novedades sin leer que muestra el inicio de dirección (el resto, en /novedades). */
const DIR_INICIO_UNREAD_LIMIT = 5;

/**
 * O2-11a-2 — INICIO DE DIRECCIÓN (SOLO LECTURA). Dos bloques de COLAS de tareas
 * (conteos + deep-links) que espejan la página web `direccion-home.tsx`, calculados
 * club-wide en core (`getDireccionHomeCountsFromClient`). Las supresiones solo se
 * cuentan si el rol es admin_club (paridad con la web). Las ACCIONES (aprobar
 * festivo, decidir supresión) son 11c — aquí solo el número + el deep-link a la
 * pantalla (que de momento abre la vista en lectura). Caché club-scoped.
 */
export function DireccionInicioScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const role = activeClub?.role ?? null;
  const isAdminClub = role === 'admin_club';
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<DireccionHomeCounts | null>(
    `${clubScopedCacheKey('dir-inicio', clubId ?? 'none')}.${role ?? 'none'}`,
    (sb) =>
      clubId
        ? getDireccionHomeCountsFromClient(sb, clubId, { includeErasures: isAdminClub })
        : Promise.resolve(null),
  );

  // Bloque 3 · Novedades NO LEÍDAS. Feed POR-USUARIO (RLS select-own; sin clubId, como
  // /novedades). Clave `novedades.dir-inicio` (primer token `novedades`) → la invalida
  // `invalidateAfterWrite('markNotifications')` igual que a la pantalla completa, y NO
  // colisiona con `novedades.unread` (limit 10) de esa pantalla. Coste: 1 query de ≤5
  // filas pequeñas, indexada por channel/status; despreciable en una pantalla que ya
  // hace 1 query. `hiddenIds` oculta al instante las que se marcan leídas (optimista).
  const tFeed = useTranslations('home.feed');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const { data: unreadData } = useCached<NotificationFeedRow[]>(
    'novedades.dir-inicio',
    (sb) => getUnreadNotificationsFeedFromClient(sb, DIR_INICIO_UNREAD_LIMIT),
  );

  if (loading) return <LoadingScreen />;
  const c = data;
  const unread = (unreadData ?? []).filter((n) => !hiddenIds.has(n.id));

  // Tocar una novedad: la marca leída (desaparece del bloque de pendientes) e invalida
  // la caché de novedades (bloque + pantalla completa coherentes). Solo la supresión
  // RGPD navega (directionFeedTarget); el resto es informativo. Espeja `openRow`.
  const openNovedad = (n: NotificationFeedRow) => {
    const target = directionFeedTarget(n.type);
    if (n.status === 'pending') {
      setHiddenIds((prev) => new Set(prev).add(n.id));
      void (async () => {
        await markNotificationReadFromClient(supabase, n.id);
        void invalidateAfterWrite('markNotifications');
      })();
    }
    if (target) router.push(target as Href);
  };

  // Deep-links a las pantallas de dirección destino. HOMOGENEIZADO (decisión Jose):
  // las 7 tarjetas se comportan igual — clicables SOLO con contador > 0 (a 0 la fila
  // queda gris e inerte) → nunca pantalla vacía. supresiones y festivos siguen siendo
  // alcanzables por el MENÚ hamburguesa de dirección (DIRECTION_MENU: calendario +
  // supresiones), así que gatear su tarjeta no los deja inaccesibles a contador 0.
  const block1 = [
    { key: 'invitations', count: c?.pendingInvitations ?? 0, href: '/direction/invitaciones-equipos' as const },
    ...(isAdminClub
      ? [{ key: 'erasures', count: c?.pendingErasures ?? 0, href: '/direction/supresiones' as const }]
      : []),
    { key: 'approvals', count: c?.pendingApprovals ?? 0, href: '/direction/calendario-festivos' as const },
  ];
  // Eventos (D2-1) → detalle; reports (D2-2) → lista terminal de progreso por
  // equipo/campaña. Misma regla que block1: clicable SOLO con contador > 0.
  const block2 = [
    { key: 'no_session', count: c?.trainingsWithoutSession ?? 0, href: '/direction/pendientes-sesion' as const },
    { key: 'no_attendance', count: c?.trainingsWithoutAttendance ?? 0, href: '/direction/pendientes-asistencia' as const },
    { key: 'callups', count: c?.pendingCallups ?? 0, href: '/direction/pendientes-convocatoria' as const },
    { key: 'reports', count: c?.pendingReports ?? 0, href: '/direction/pendientes-informes' as const },
  ];

  const go = (href: string | null) => {
    if (href) router.push(href);
  };

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <View className="gap-2">
          <ScreenTitle>{t('home.direccion.management_title')}</ScreenTitle>
          {block1.map((r) => (
            <TaskRow
              key={r.key}
              label={t(`dir_inicio.${r.key}`)}
              count={r.count}
              accent={accent}
              onPress={r.href && r.count > 0 ? () => go(r.href) : undefined}
            />
          ))}
        </View>

        <View className="gap-2">
          <ScreenTitle>{t('dir_inicio.tasks_title')}</ScreenTitle>
          {block2.map((r) => (
            <TaskRow
              key={r.key}
              label={t(`dir_inicio.${r.key}`)}
              count={r.count}
              accent={accent}
              onPress={r.href && r.count > 0 ? () => go(r.href) : undefined}
            />
          ))}
        </View>

        {/* Bloque 3 · Novedades NO LEÍDAS (5 más recientes) + "Ver todas". */}
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <ScreenTitle>{t('dir_inicio.novedades_title')}</ScreenTitle>
            <Pressable
              onPress={() => router.push('/direction/novedades')}
              className="active:opacity-60"
            >
              <Text className="text-xs font-medium" style={{ color: accent }}>
                {t('dir_inicio.novedades_see_all')}
              </Text>
            </Pressable>
          </View>
          {unread.length === 0 ? (
            <Text className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-400">
              {t('dir_inicio.novedades_empty')}
            </Text>
          ) : (
            unread.map((n) => (
              <Pressable
                key={n.id}
                onPress={() => openNovedad(n)}
                className="flex-row items-start gap-3 rounded-2xl border border-zinc-200 p-4 active:opacity-70"
              >
                <View className="mt-1.5 h-2 w-2 rounded-full bg-emerald-500" />
                <View className="flex-1">
                  <Text className="text-sm text-[#0F1B2E]">
                    {notificationFeedText(tFeed, n.type, n.payload)}
                  </Text>
                  <Text className="text-xs text-zinc-400">{n.created_at.slice(0, 10)}</Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** Fila de cola: etiqueta + contador. Pulsable si hay pantalla destino (deep-link). */
function TaskRow({
  label,
  count,
  accent,
  onPress,
}: {
  label: string;
  count: number;
  accent: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      className={`flex-row items-center gap-3 rounded-2xl border border-zinc-200 p-4 ${onPress ? 'active:opacity-70' : ''}`}
      style={{ borderLeftWidth: 4, borderLeftColor: count > 0 ? accent : '#e4e4e7' }}
    >
      <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={2}>
        {label}
      </Text>
      <CountBadge count={count} accent={accent} />
      {onPress ? <Text className="text-zinc-300">›</Text> : null}
    </Pressable>
  );
}
