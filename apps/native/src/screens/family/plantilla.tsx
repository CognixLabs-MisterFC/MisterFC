import { ScrollView, Text, View } from 'react-native';
import {
  getTeamRosterStatsFromClient,
  teamScopedCacheKey,
  type RosterStatRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-5 D1 — Plantilla: roster del equipo con stats por compañero (SOLO LECTURA).
 * Fetch + agregación en core (`getTeamRosterStatsFromClient` → `aggregateTeamStats`).
 * Caché team-scoped. `teamId` llega por navegación desde Mi equipo.
 */
export function PlantillaScreen({ teamId, teamName }: { teamId: string | null; teamName: string | null }) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<RosterStatRow[]>(
    teamScopedCacheKey('plantilla', clubId ?? 'none', teamId ?? 'none'),
    (sb) => (teamId ? getTeamRosterStatsFromClient(sb, teamId) : Promise.resolve([])),
  );

  if (!teamId) return <EmptyState message={t('mi_equipo.no_team')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{t('mi_equipo.nav_plantilla')}</Text>
        {teamName ? <Text className="mb-1 text-xs text-zinc-400">{teamName}</Text> : null}
        {rows.length === 0 ? (
          <EmptyState message={t('mi_equipo.plantilla_empty')} />
        ) : (
          rows.map((r) => (
            <View key={r.player_id} className="flex-row items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2">
              <View className="h-8 w-8 items-center justify-center rounded-full bg-zinc-100">
                <Text className="text-xs font-semibold text-zinc-600">{r.dorsal ?? '—'}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                  {[r.first_name, r.last_name].filter(Boolean).join(' ')}
                </Text>
                <Text className="text-[11px] text-zinc-400">
                  {[
                    r.position ? t(`jugadores.positions.${r.position}`) : null,
                    `${r.stats.matches} ${t('ficha.matches_short')}`,
                    `${r.stats.goals} ${t('ficha.goals_short')}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
