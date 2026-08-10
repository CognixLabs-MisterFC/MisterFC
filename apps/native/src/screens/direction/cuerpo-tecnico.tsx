import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getClubStaffFromClient,
  clubScopedCacheKey,
  type ClubStaffRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { ListCard, RoleChip } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-11a-2 — CUERPO TÉCNICO de DIRECCIÓN (lista CLUB-WIDE, SOLO LECTURA). Enumera
 * todo el cuerpo técnico del club vía `getClubStaffFromClient` (lectura NUEVA de
 * core, club-wide — no el motor de gestión de la web). Al tocar uno se abre su ficha
 * en lectura (`/direction/coach?membershipId`). NADA de mover staff (es web).
 * Candado = AreaGuard('direction'); caché club-scoped.
 */
export function DireccionCuerpoTecnicoScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<ClubStaffRow[]>(
    clubScopedCacheKey('dir-cuerpo', clubId ?? 'none'),
    (sb) => (clubId ? getClubStaffFromClient(sb, clubId) : Promise.resolve([])),
  );

  if (loading) return <LoadingScreen />;
  const coaches = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('dir_cuerpo.title')}</ScreenTitle>
        {coaches.length === 0 ? (
          <EmptyState message={t('dir_cuerpo.empty')} />
        ) : (
          coaches.map((c) => (
            <ListCard
              key={c.membershipId}
              accent={c.assignments[0]?.teamColor || accent}
              onPress={() =>
                router.push({
                  pathname: '/direction/coach',
                  params: { membershipId: c.membershipId, name: c.fullName },
                })
              }
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-base font-semibold text-[#0F1B2E]" numberOfLines={1}>
                  {c.fullName}
                </Text>
                <RoleChip label={t(`club_role.${c.clubRole}`)} />
              </View>
              <Text className="mt-0.5 text-xs text-zinc-400" numberOfLines={1}>
                {c.assignments.map((a) => a.teamName).join(' · ') || t('dir_cuerpo.no_team')}
              </Text>
            </ListCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
