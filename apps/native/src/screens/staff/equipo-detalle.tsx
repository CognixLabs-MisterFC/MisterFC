import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getTeamRosterStatsFromClient,
  formatPlayerName,
  teamScopedCacheKey,
  type RosterStatRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { Tile } from './hub-parts';

/**
 * O2-10a — Detalle de un equipo del staff (llegado desde "Mis equipos" con teamId).
 * Muestra la PLANTILLA (roster, `getTeamRosterStatsFromClient`) y da paso a las dos
 * consultas que cuelgan del detalle: Estadísticas de equipo y Cuerpo técnico
 * (ambas con el mismo teamId). Solo lectura; RLS = gate (staff del equipo). Caché
 * team-scoped (`staff-roster.${clubId}.${teamId}`).
 */
export function TeamDetailScreen({
  teamId,
  name,
  color,
}: {
  teamId: string | null;
  name: string | null;
  color: string | null;
}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = color || theme?.color || BRAND.navy;

  const { data, fromCache, loading } = useCached<RosterStatRow[]>(
    teamScopedCacheKey('staff-roster', clubId ?? 'none', teamId ?? 'none'),
    async (sb) => {
      if (!teamId) return [];
      return getTeamRosterStatsFromClient(sb, teamId);
    },
  );

  if (!teamId) return <EmptyState message={t('equipo_detalle.pick_team')} />;
  if (loading) return <LoadingScreen />;
  const roster = data ?? [];

  const go = (pathname: string) =>
    router.push({ pathname, params: { teamId, name: name ?? '', color: accent } });

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{name ?? t('equipo_detalle.title')}</ScreenTitle>

        <View className="flex-row flex-wrap gap-2">
          <Tile icon="📊" label={t('equipo_detalle.stats')} accent={accent} onPress={() => go('/staff/estadisticas-equipo')} />
          <Tile icon="👔" label={t('equipo_detalle.staff')} accent={accent} onPress={() => go('/staff/cuerpo-tecnico-ligero')} />
        </View>

        <Text className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('equipo_detalle.roster')} · {roster.length}
        </Text>
        {roster.length === 0 ? (
          <Text className="py-2 text-sm text-zinc-400">{t('equipo_detalle.no_roster')}</Text>
        ) : (
          <View className="rounded-2xl border border-zinc-200">
            {roster.map((p, i) => (
              <View
                key={p.player_id}
                className={`flex-row items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
              >
                <Text className="w-7 text-right text-sm font-bold text-zinc-400 tabular-nums">
                  {p.dorsal ?? '—'}
                </Text>
                <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                  {formatPlayerName(p.first_name, p.last_name)}
                </Text>
                {p.position ? (
                  <Text className="text-xs text-zinc-400">{p.position}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
