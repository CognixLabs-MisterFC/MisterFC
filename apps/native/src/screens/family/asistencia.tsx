import { ScrollView, Text, View } from 'react-native';
import {
  getAttendanceStatsFromClient,
  attendanceStatsWindow,
  playerScopedCacheKey,
  type AttendanceStatsResult,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { ChildSelector } from '@/ui/child-selector';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-5 E1 — Histórico de asistencia del HIJO ACTIVO (consulta), SOLO LECTURA. La
 * familia NO pasa lista (eso es staff/campo). El fetch+agregación viven en core
 * (getAttendanceStatsFromClient con scope player = hijo activo, ventana de curso).
 * Caché player-scoped: cambiar de hijo → key distinta.
 */
export function AsistenciaScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<AttendanceStatsResult>(
    playerScopedCacheKey('asistencia', clubId ?? 'none', playerId ?? 'none'),
    async (sb) => {
      if (!clubId || !playerId) return { byPlayer: [], byCode: [], totalRecorded: 0 };
      const { startIso, endIso } = attendanceStatsWindow('season', new Date());
      return getAttendanceStatsFromClient(sb, {
        clubId,
        scope: { kind: 'player', playerIds: [playerId] },
        startIso,
        endIso,
      });
    },
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;

  const stats = data ?? { byPlayer: [], byCode: [], totalRecorded: 0 };
  const child = stats.byPlayer[0] ?? null;

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('asistencia.family_title')}</ScreenTitle>
        <Text className="text-xs text-zinc-400">{t('asistencia.range_season')}</Text>

        {!child || stats.totalRecorded === 0 ? (
          <EmptyState message={t('asistencia.empty')} />
        ) : (
          <>
            {/* Resumen: % de presencia. */}
            <View className="items-center rounded-2xl border border-zinc-200 p-4">
              <Text className="text-4xl font-bold" style={{ color: accent }}>
                {Math.round(child.pct_present)}%
              </Text>
              <Text className="mt-1 text-xs text-zinc-400">{t('asistencia.pct_present')}</Text>
              <Text className="mt-1 text-xs text-zinc-400">
                {t('asistencia.total', { n: String(child.total) })}
              </Text>
            </View>

            {/* Desglose por tipo. */}
            <View className="rounded-2xl border border-zinc-200 p-4">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t('asistencia.breakdown')}
              </Text>
              <StatLine label={t('asistencia.codes.presente')} value={child.present} color="#16a34a" />
              <StatLine label={t('asistencia.justified')} value={child.justified} color="#d97706" />
              <StatLine label={t('asistencia.codes.entreno_diferenciado')} value={child.partial} color="#0284c7" />
              <StatLine label={t('asistencia.codes.ausente')} value={child.unjustified} color="#dc2626" />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatLine({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-zinc-100 py-2">
      <View className="flex-row items-center gap-2">
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <Text className="text-sm text-[#0F1B2E]">{label}</Text>
      </View>
      <Text className="text-sm font-semibold text-[#0F1B2E]">{value}</Text>
    </View>
  );
}
