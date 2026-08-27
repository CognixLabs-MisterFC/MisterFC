import { FlatList, Text, View } from 'react-native';
import {
  clubScopedCacheKey,
  listTeamReportPlayerStatusFromClient,
  type TeamReportPlayerStatus,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * 19-B — Listado por JUGADOR del estado del informe de un equipo en un periodo: nombre +
 * si está COMPLETADO. SOLO ESTADO — decisión de Jose: NO se abre el informe desde aquí (ni
 * enlace, ni chevron), ni para el director ni para el entrenador. El criterio de
 * "completado" (reportStatus) es el mismo que el nivel-1 → el "X de Y" cuadra.
 *
 * MONTADO POR DOS ÁREAS (aunque el nombre empiece por "Direccion"): dirección (19-B, 2º
 * nivel de pendientes-informes, club-wide) y STAFF (19-C, informes del entrenador de SUS
 * equipos). Es presentacional (recibe teamId/period/teamName) y el loader no está atado a
 * ningún scope. La caché `dir-report-players` se COMPARTE a propósito: para un mismo
 * (club, equipo, periodo) el dato es idéntico lo mire quien lo mire → acierto de caché.
 * NO renombrar sin actualizar los dos montajes (staff y dirección).
 */
export function DireccionReportPlayersScreen({
  teamId,
  period,
  teamName,
}: {
  teamId: string;
  period: string;
  teamName: string;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<TeamReportPlayerStatus[]>(
    clubScopedCacheKey('dir-report-players', `${clubId ?? 'none'}.${teamId}.${period}`),
    (sb) => listTeamReportPlayerStatusFromClient(sb, teamId, period),
  );

  const rows = data ?? [];
  const doneCount = rows.filter((p) => p.completed).length;

  if (loading) return <LoadingScreen />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(p) => p.playerId}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
        ListHeaderComponent={
          <View className="mb-1">
            <ScreenTitle>{teamName}</ScreenTitle>
            <Text className="px-4 text-xs text-zinc-500">
              {`${t(`informes.period_short.${period}`)} · ${t('dir_inicio.report_progress', {
                done: String(doneCount),
                total: String(rows.length),
              })}`}
            </Text>
          </View>
        }
        ListEmptyComponent={<EmptyState message={t('informes.roster_empty')} />}
        renderItem={({ item }) => (
          <View className="flex-row items-center justify-between rounded-2xl border border-zinc-200 p-4">
            <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
              {item.name}
            </Text>
            <View
              className={`rounded-full px-2.5 py-1 ${
                item.completed ? 'bg-emerald-100' : 'bg-zinc-100'
              }`}
            >
              <Text
                className={`text-[11px] font-semibold ${
                  item.completed ? 'text-emerald-700' : 'text-zinc-500'
                }`}
              >
                {item.completed
                  ? t('informes.player_status.completed')
                  : t('informes.player_status.pending')}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
