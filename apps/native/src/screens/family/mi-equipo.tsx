import { useState } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getActiveSeasonLabelFromClient,
  getPlayerTeamsFromClient,
  getTeamHomeFromClient,
  playerScopedCacheKey,
  teamScopedCacheKey,
  type PlayerTeamMembership,
  type TeamHome,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { ChildSelector } from '@/ui/child-selector';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/**
 * O2-5 D1 — Mi equipo (home del HIJO ACTIVO, SOLO LECTURA). Divergencia deliberada
 * de la web: los equipos se derivan del JUGADOR ACTIVO (no se agregan los de todos
 * los hijos). El fetch (equipos + home) vive en core. Si el hijo activo tiene varios
 * equipos, hay un selector de equipo INTERNO (secundario al selector de hijo).
 * Caché: lista de equipos player-scoped; home team-scoped.
 */
export function MiEquipoScreen() {
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;
  const [teamId, setTeamId] = useState<string | null>(null);

  const teams = useCached<PlayerTeamMembership[]>(
    playerScopedCacheKey('teams', clubId ?? 'none', playerId ?? 'none'),
    async (sb) => {
      if (!clubId || !playerId) return [];
      const season = await getActiveSeasonLabelFromClient(sb, clubId);
      return getPlayerTeamsFromClient(sb, clubId, [playerId], season);
    },
  );

  const list = teams.data ?? [];
  const activeTeam = list.find((tm) => tm.team_id === teamId) ?? list[0] ?? null;
  const allTeamIds = list.map((tm) => tm.team_id);

  const home = useCached<TeamHome | null>(
    teamScopedCacheKey('home', clubId ?? 'none', activeTeam?.team_id ?? 'none'),
    (sb) =>
      clubId && activeTeam && playerId
        ? getTeamHomeFromClient(
            sb,
            clubId,
            activeTeam.team_id,
            playerId,
            allTeamIds,
            new Date().toISOString(),
          )
        : Promise.resolve(null),
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (teams.loading) return <LoadingScreen />;
  if (!activeTeam) {
    return (
      <View className="flex-1 bg-white">
        <ChildSelector />
        <EmptyState message={t('mi_equipo.no_team')} />
      </View>
    );
  }

  const h = home.data;
  const goTeam = (pathname: string) =>
    router.push({
      pathname,
      params: { teamId: activeTeam.team_id, teamName: activeTeam.name, color: activeTeam.color },
    });

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={teams.fromCache || home.fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {/* Selector de equipo INTERNO (si el hijo activo tiene varios). */}
        {list.length > 1 ? (
          <View className="flex-row flex-wrap gap-2">
            {list.map((tm) => {
              const on = tm.team_id === activeTeam.team_id;
              return (
                <Pressable
                  key={tm.team_id}
                  onPress={() => setTeamId(tm.team_id)}
                  className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
                  style={on ? { backgroundColor: accent } : undefined}
                >
                  <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>
                    {tm.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Cabecera del equipo. */}
        <View className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 p-4">
          <View className="h-4 w-4 rounded-full" style={{ backgroundColor: activeTeam.color }} />
          <View className="flex-1">
            <Text className="text-lg font-bold text-[#0F1B2E]">{activeTeam.name}</Text>
            <Text className="text-xs text-zinc-400">
              {[activeTeam.category_name, activeTeam.season].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* Accesos a subpantallas. */}
        <View className="flex-row flex-wrap gap-2">
          <NavChip label={t('mi_equipo.nav_plantilla')} accent={accent} onPress={() => goTeam('/family/plantilla')} />
          <NavChip label={t('mi_equipo.nav_staff')} accent={accent} onPress={() => goTeam('/family/cuerpo-tecnico')} />
          <NavChip label={t('mi_equipo.nav_sesiones')} accent={accent} onPress={() => goTeam('/family/sesiones')} />
          <NavChip label={t('mi_equipo.nav_playbook')} accent={accent} onPress={() => goTeam('/family/jugadas')} />
        </View>

        {/* Compañeros. */}
        <Section title={t('mi_equipo.teammates')}>
          {!h || h.teammates.length === 0 ? (
            <Text className="text-sm text-zinc-500">{t('mi_equipo.teammates_empty')}</Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {h.teammates.map((tm) => (
                <View key={tm.id} className="flex-row items-center gap-2 rounded-md border border-zinc-200 px-2 py-1">
                  <View className="h-6 w-6 items-center justify-center rounded-full bg-zinc-100">
                    <Text className="text-[10px] font-semibold text-zinc-600">{tm.dorsal ?? '—'}</Text>
                  </View>
                  <Text className="text-sm text-[#0F1B2E]">{tm.full_name}</Text>
                </View>
              ))}
            </View>
          )}
        </Section>

        {/* Próximos eventos. */}
        <Section title={t('mi_equipo.upcoming')}>
          {!h || h.upcoming.length === 0 ? (
            <Text className="text-sm text-zinc-500">{t('mi_equipo.upcoming_empty')}</Text>
          ) : (
            h.upcoming.map((e) => (
              <View key={e.id} className="border-b border-zinc-100 py-2">
                <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>{e.title}</Text>
                <Text className="text-xs text-zinc-400" numberOfLines={1}>
                  {[
                    new Date(e.starts_at).toLocaleString(),
                    e.opponent_name ? `vs ${e.opponent_name}` : null,
                    e.location_name,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))
          )}
        </Section>

        {/* Anuncios del equipo. */}
        <Section title={t('mi_equipo.announcements')}>
          {!h || h.announcements.length === 0 ? (
            <Text className="text-sm text-zinc-500">{t('mi_equipo.announcements_empty')}</Text>
          ) : (
            h.announcements.map((a) => (
              <View key={a.id} className="border-b border-zinc-100 py-2">
                <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                  {a.pinned ? '📌 ' : ''}{a.title}
                </Text>
                <Text className="text-xs text-zinc-400">
                  {a.team_id === null ? t('mi_equipo.club_wide') : activeTeam.name}
                  {' · '}{new Date(a.created_at).toLocaleDateString()}
                </Text>
              </View>
            ))
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function NavChip({ label, accent, onPress }: { label: string; accent: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded-full px-4 py-2 active:opacity-70" style={{ backgroundColor: accent }}>
      <Text className="text-xs font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</Text>
      {children}
    </View>
  );
}
