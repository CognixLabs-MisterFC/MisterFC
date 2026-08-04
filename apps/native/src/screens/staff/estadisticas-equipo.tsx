import { ScrollView, Text, View } from 'react-native';
import {
  getTeamRosterStatsFromClient,
  formatPlayerName,
  teamScopedCacheKey,
  type RosterStatRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';
import { MisEquiposScreen } from './mis-equipos';

/**
 * O2-10a — Estadísticas de equipo (consulta). Reutiliza `getTeamRosterStatsFromClient`
 * + los agregados puros ya en core (AggregatedStats). Solo lectura (el PDF es web).
 * Con teamId muestra la tabla; sin teamId reusa "Mis equipos" como PICKER. RLS =
 * gate. Caché team-scoped (`staff-team-stats::${clubId}::${teamId}`).
 */
export function TeamStatsScreen({ teamId, name }: { teamId: string | null; name: string | null }) {
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<RosterStatRow[]>(
    teamScopedCacheKey('staff-team-stats', clubId ?? 'none', teamId ?? 'none'),
    async (sb) => {
      if (!teamId) return [];
      return getTeamRosterStatsFromClient(sb, teamId);
    },
  );

  // Sin teamId → selector de equipo (llega desde el menú, no desde el detalle).
  if (!teamId) return <MisEquiposScreen target="stats" />;
  if (loading) return <LoadingScreen />;
  const roster = data ?? [];
  if (roster.length === 0) return <EmptyState message={t('estadisticas_equipo.empty')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{name ? `${t('estadisticas_equipo.title')} · ${name}` : t('estadisticas_equipo.title')}</ScreenTitle>

        {/* Cabecera de columnas. */}
        <View className="flex-row items-center gap-2 px-2">
          <Text className="flex-1 text-[10px] font-semibold uppercase text-zinc-400">{t('estadisticas_equipo.player')}</Text>
          {(['pj', 'g', 'a', 'min'] as const).map((k) => (
            <Text key={k} className="w-9 text-right text-[10px] font-semibold uppercase text-zinc-400">
              {t(`estadisticas_equipo.col_${k}`)}
            </Text>
          ))}
        </View>

        <View className="rounded-2xl border border-zinc-200" style={{ borderLeftWidth: 4, borderLeftColor: accent }}>
          {roster.map((p, i) => (
            <View
              key={p.player_id}
              className={`flex-row items-center gap-2 px-3 py-2.5 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
            >
              <Text className="w-6 text-right text-xs font-bold text-zinc-400 tabular-nums">{p.dorsal ?? '—'}</Text>
              <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                {formatPlayerName(p.first_name, p.last_name)}
              </Text>
              <Cell value={p.stats.matches} />
              <Cell value={p.stats.goals} />
              <Cell value={p.stats.assists} />
              <Cell value={p.stats.minutesPlayed} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Cell({ value }: { value: number }) {
  return <Text className="w-9 text-right text-sm text-[#0F1B2E] tabular-nums">{value}</Text>;
}
