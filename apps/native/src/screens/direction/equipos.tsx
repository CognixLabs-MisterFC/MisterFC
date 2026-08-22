import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getClubTeamsFromClient,
  clubScopedCacheKey,
  type ClubTeamCard,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { ListCard } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * D1b-1 — EQUIPOS de DIRECCIÓN (lista CLUB-WIDE, SOLO LECTURA). Enumera todos los
 * equipos del club en temporada activa (`getClubTeamsFromClient`, RLS club-wide; NO
 * el picker `getStaffTeamsFromClient`, que a un director le devuelve 0 por ir atado a
 * `team_staff`). Al tocar uno se abre su detalle en `/direction/equipo?teamId`.
 * Candado de la banda = AreaGuard('direction'); caché club-scoped (misma clave
 * `club-teams` que el picker de anuncios, mismos datos). Patrón visual de
 * `anuncios-picker` (ListCard). Sustituye al placeholder.
 */
export function DireccionEquiposScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<ClubTeamCard[]>(
    clubScopedCacheKey('club-teams', clubId ?? 'none'),
    (sb) => (clubId ? getClubTeamsFromClient(sb, clubId) : Promise.resolve([])),
  );

  if (loading) return <LoadingScreen />;
  const teams = data ?? [];
  if (teams.length === 0) return <EmptyState message={t('anuncios_dir.no_teams')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
        <ScreenTitle>{t('shell.nav.equipos')}</ScreenTitle>
        {teams.map((team) => (
          <ListCard
            key={team.teamId}
            accent={team.color || accent}
            onPress={() =>
              router.push({
                pathname: '/direction/equipo',
                params: { teamId: team.teamId, name: team.name, color: team.color },
              })
            }
          >
            <View className="flex-row items-center gap-2">
              <View
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: team.color || accent }}
              />
              <Text className="flex-1 text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
                {team.name}
              </Text>
              {team.format ? (
                <View className="rounded-full bg-zinc-100 px-2 py-0.5">
                  <Text className="text-[10px] font-semibold text-zinc-500">{team.format}</Text>
                </View>
              ) : null}
            </View>
            <Text className="mt-0.5 text-xs text-zinc-400">{team.categoryName}</Text>
          </ListCard>
        ))}
      </ScrollView>
    </View>
  );
}
