import { FlatList, Text, View } from 'react-native';
import {
  clubScopedCacheKey,
  listTeamsReportProgressFromClient,
  type DireccionTeamReportProgress,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * D2-2 — Progreso de informes POR EQUIPO Y CAMPAÑA para dirección (SOLO CONSULTA,
 * club-wide). Una fila por (equipo × campaña lanzada) con informes pendientes:
 * "Cadete A · Inicial · 8 de 20" — para saber a qué entrenador apretar. NO lista
 * jugadores ni abre visor de informe. Filas NO pulsables.
 */
export function DireccionReportsProgressScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<DireccionTeamReportProgress[]>(
    clubScopedCacheKey('dir-pend-reports', clubId ?? 'none'),
    (sb) => (clubId ? listTeamsReportProgressFromClient(sb, clubId) : Promise.resolve([])),
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.teamId}:${r.period}`}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
        ListHeaderComponent={<ScreenTitle>{t('dir_inicio.reports')}</ScreenTitle>}
        ListEmptyComponent={<EmptyState message={t('dir_inicio.list_empty')} />}
        renderItem={({ item }) => (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
              {item.team_name}
            </Text>
            <Text className="mt-1 text-xs text-zinc-500">
              {`${t(`informes.period_short.${item.period}`)} · ${t('dir_inicio.report_progress', {
                done: String(item.done),
                total: String(item.total),
              })}`}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
