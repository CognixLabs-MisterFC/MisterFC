import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getClubPlayersFromClient,
  clubScopedCacheKey,
  formatPlayerName,
  type ClubPlayerRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { ListCard } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-11a-2 — JUGADORES de DIRECCIÓN (lista CLUB-WIDE, SOLO LECTURA). Enumera todos
 * los jugadores club-activos (no suprimidos, no bajas) vía `getClubPlayersFromClient`
 * (lectura NUEVA de core, club-wide — no el motor filtrado/paginado de la web).
 * Al tocar uno se abre su ficha en lectura (`/direction/jugador?playerId`). NADA de
 * crear/editar (es web). Candado = AreaGuard('direction'); caché club-scoped.
 */
export function DireccionJugadoresScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<ClubPlayerRow[]>(
    clubScopedCacheKey('dir-jugadores', clubId ?? 'none'),
    (sb) => (clubId ? getClubPlayersFromClient(sb, clubId) : Promise.resolve([])),
  );

  if (loading) return <LoadingScreen />;
  const players = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('dir_jugadores.title')}</ScreenTitle>
        {players.length === 0 ? (
          <EmptyState message={t('dir_jugadores.empty')} />
        ) : (
          players.map((p) => (
            <ListCard
              key={p.id}
              accent={p.currentTeamColor || accent}
              onPress={() =>
                router.push({
                  pathname: '/direction/jugador',
                  params: { playerId: p.id, name: formatPlayerName(p.firstName, p.lastName) },
                })
              }
            >
              <View className="flex-row items-center gap-3">
                <Text className="w-7 text-right text-sm font-bold text-zinc-400 tabular-nums">
                  {p.dorsal ?? '—'}
                </Text>
                <Text className="flex-1 text-base font-semibold text-[#0F1B2E]" numberOfLines={1}>
                  {formatPlayerName(p.firstName, p.lastName)}
                </Text>
              </View>
              <Text className="mt-0.5 pl-10 text-xs text-zinc-400" numberOfLines={1}>
                {p.currentTeamName ?? t('jugadores.no_team')}
                {p.positionMain ? ` · ${p.positionMain}` : ''}
              </Text>
            </ListCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
