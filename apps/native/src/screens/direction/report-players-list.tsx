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
 * 19-B — Segundo nivel del progreso de informes para DIRECCIÓN: los jugadores del roster
 * de un equipo con si su informe de la campaña está COMPLETADO o no. SOLO ESTADO —
 * decisión de Jose: NO se abre el informe desde aquí (ni enlace, ni chevron). Club-wide,
 * solo consulta; el criterio de "completado" (reportStatus) es el mismo que el nivel-1,
 * así que el "X de Y" cuadra. Caché propia `dir-report-players`.
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
    clubScopedCacheKey('dir-report-players', `${clubId ?? 'none'}:${teamId}:${period}`),
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
