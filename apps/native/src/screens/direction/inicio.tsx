import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getDireccionHomeCountsFromClient,
  clubScopedCacheKey,
  type DireccionHomeCounts,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { CountBadge } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

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

  if (loading) return <LoadingScreen />;
  const c = data;

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
