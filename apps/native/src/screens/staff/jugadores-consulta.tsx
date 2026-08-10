import { ScrollView, Text, View } from 'react-native';
import {
  getTeamRosterStatsFromClient,
  formatPlayerName,
  teamScopedCacheKey,
  type RosterStatRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActiveStaffTeam } from '@/auth/active-staff-team';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { StaffTeamSelector } from '@/ui/staff-team-selector';
import { useTranslations } from '@/locale/provider';

/**
 * O2-10b-2 — JUGADORES (coordinador, modo CONSULTA — SOLO LECTURA). Lista de
 * jugadores del EQUIPO ACTIVO (selector global). Reutiliza la lectura team-scoped de
 * core `getTeamRosterStatsFromClient` (RLS de compañero de equipo, acotada a los
 * equipos del coordinador porque el selector solo ofrece sus team_staff). NADA de
 * crear/editar (es web). Caché team-scoped (`coord-jugadores::${clubId}::${teamId}`).
 */
export function JugadoresConsultaScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const { loading: teamLoading, activeTeam } = useActiveStaffTeam();
  const clubId = activeClub?.club.id ?? null;
  const teamId = activeTeam?.teamId ?? null;

  const { data, fromCache, loading } = useCached<RosterStatRow[]>(
    teamScopedCacheKey('coord-jugadores', clubId ?? 'none', teamId ?? 'none'),
    (sb) => (teamId ? getTeamRosterStatsFromClient(sb, teamId) : Promise.resolve([])),
  );

  if (teamLoading) return <LoadingScreen />;
  if (!activeTeam) return <EmptyState message={t('jugadores_consulta.no_team')} />;
  if (loading) return <LoadingScreen />;

  const roster = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <StaffTeamSelector />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('jugadores_consulta.title')}</ScreenTitle>
        {roster.length === 0 ? (
          <EmptyState message={t('jugadores_consulta.empty')} />
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
