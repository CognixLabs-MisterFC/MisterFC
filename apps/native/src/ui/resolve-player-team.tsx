import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  getActiveSeasonLabelFromClient,
  getPlayerTeamsFromClient,
  playerScopedCacheKey,
  type PlayerTeamMembership,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

export type ResolvedTeam = { id: string; name: string; color: string };

/**
 * Resuelve el EQUIPO del jugador activo para pantallas alcanzadas DESDE EL MENÚ
 * (sin `teamId` por parámetro): Entrenamientos y Playbook. Reutiliza el patrón de
 * Mi equipo: selector de hijo + selector de equipo interno si el hijo activo tiene
 * varios (misma caché player-scoped 'teams'). Las pantallas abiertas CON `teamId`
 * (chips de Mi equipo) NO pasan por aquí: renderizan directas.
 */
export function ResolvePlayerTeam({
  children,
}: {
  children: (team: ResolvedTeam) => ReactNode;
}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
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

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (teams.loading) return <LoadingScreen />;
  if (!activeTeam) {
    return (
      <View className="flex-1 bg-white">
        <EmptyState message={t('mi_equipo.family_no_team')} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {list.length > 1 ? (
        <View className="flex-row flex-wrap gap-2 px-4 pt-3">
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
      {children({ id: activeTeam.team_id, name: activeTeam.name, color: activeTeam.color })}
    </View>
  );
}
