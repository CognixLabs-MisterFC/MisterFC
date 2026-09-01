import { ScrollView, Text, View } from 'react-native';
import {
  getTeamRosterStatsFromClient,
  getTeamPlayersWithoutAppFromClient,
  formatPlayerName,
  teamScopedCacheKey,
  type PlayersWithoutApp,
  type RosterStatRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActiveStaffTeam } from '@/auth/active-staff-team';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { StaffTeamSelector } from '@/ui/staff-team-selector';
import { NoAppBadge } from '@/ui/no-app-badge';
import { useTranslations } from '@/locale/provider';

/**
 * O2-10b-2 — JUGADORES (coordinador, modo CONSULTA — SOLO LECTURA). Lista de
 * jugadores del EQUIPO ACTIVO (selector global). Reutiliza la lectura team-scoped de
 * core `getTeamRosterStatsFromClient` (RLS de compañero de equipo, acotada a los
 * equipos del coordinador porque el selector solo ofrece sus team_staff). NADA de
 * crear/editar (es web). Caché team-scoped (`coord-jugadores.${clubId}.${teamId}`).
 *
 * Slice B — marcador "Sin app", en una lectura APARTE (`no-app.<club>.<team>`): el
 * loader del roster lo comparte con la plantilla de FAMILIA, que no pinta marcador
 * y no debe pagar la consulta.
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

  // Slice B — lectura APARTE del marcador "Sin app" (ver cabecera).
  const { data: withoutApp } = useCached<PlayersWithoutApp>(
    teamScopedCacheKey('no-app', clubId ?? 'none', teamId ?? 'none'),
    (sb) => (teamId ? getTeamPlayersWithoutAppFromClient(sb, teamId) : Promise.resolve([])),
  );

  if (teamLoading) return <LoadingScreen />;
  if (!activeTeam) return <EmptyState message={t('jugadores_consulta.no_team')} />;
  if (loading) return <LoadingScreen />;

  const roster = data ?? [];
  const noAppIds = new Set(withoutApp ?? []);

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
            {roster.map((p, i) => {
              const noApp = noAppIds.has(p.player_id);
              return (
                <View
                  key={p.player_id}
                  className={`flex-row items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
                >
                  <Text className="w-7 text-right text-sm font-bold text-zinc-400 tabular-nums">
                    {p.dorsal ?? '—'}
                  </Text>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>
                      {formatPlayerName(p.first_name, p.last_name)}
                    </Text>
                    {noApp ? (
                      <NoAppBadge
                        label={t('jugadores.no_app.label')}
                        hint={t('jugadores.no_app.hint')}
                      />
                    ) : null}
                  </View>
                  {p.position ? (
                    <Text className="text-xs text-zinc-400">
                      {t(`jugadores.positions.${p.position}`)}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
