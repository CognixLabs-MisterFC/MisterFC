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
 * O2-11a-1 — Picker CLUB-WIDE de equipos para los anuncios de DIRECCIÓN. El picker de
 * staff (`MisEquiposScreen`) usa `getStaffTeamsFromClient` = los equipos `team_staff`
 * del usuario; un admin/director puede tener 0 → picker vacío. Aquí se listan TODOS
 * los equipos del club (`getClubTeamsFromClient`, RLS club-wide) y al tocar uno se
 * navega a `/direction/anuncios?teamId` → reutiliza `TeamAnnouncementsScreen` (10b-1b).
 * Solo lectura; el candado de la banda es AreaGuard('direction'). Caché club-scoped.
 */
export function DireccionAnunciosPickerScreen() {
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
        <ScreenTitle>{t('anuncios_dir.pick_team')}</ScreenTitle>
        {teams.map((team) => (
          <ListCard
            key={team.teamId}
            accent={team.color || accent}
            onPress={() =>
              router.push({
                pathname: '/direction/anuncios',
                params: { teamId: team.teamId, name: team.name, color: team.color },
              })
            }
          >
            <View className="flex-row items-center gap-2">
              <View className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color || accent }} />
              <Text className="flex-1 text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
                {team.name}
              </Text>
            </View>
            <Text className="mt-0.5 text-xs text-zinc-400">{team.categoryName}</Text>
          </ListCard>
        ))}
      </ScrollView>
    </View>
  );
}
