import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  getClubStaffFromClient,
  clubScopedCacheKey,
  type ClubStaffRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { RoleChip } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';

/**
 * O2-11a-2 — FICHA de un miembro del cuerpo técnico (DIRECCIÓN, SOLO LECTURA).
 * Reutiliza la lectura club-wide `getClubStaffFromClient` (misma caché club-scoped
 * que la lista) y selecciona la membresía del parámetro. Muestra rol de club y sus
 * asignaciones (equipo·rol de staff). NADA de gestión (mover staff es web).
 */
export function DireccionCoachFichaScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const { membershipId, name } = useLocalSearchParams<{ membershipId?: string; name?: string }>();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<ClubStaffRow[]>(
    clubScopedCacheKey('dir-cuerpo', clubId ?? 'none'),
    (sb) => (clubId ? getClubStaffFromClient(sb, clubId) : Promise.resolve([])),
  );

  if (loading) return <LoadingScreen />;
  const coach = (data ?? []).find((c) => c.membershipId === membershipId) ?? null;
  if (!coach) return <EmptyState message={t('dir_cuerpo.not_found')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <View>
          <ScreenTitle>{coach.fullName || name || ''}</ScreenTitle>
          <View className="mt-1 flex-row">
            <RoleChip label={t(`club_role.${coach.clubRole}`)} />
          </View>
        </View>

        <View className="rounded-2xl border border-zinc-200 p-4">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('dir_cuerpo.assignments')}
          </Text>
          {coach.assignments.length === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dir_cuerpo.no_team')}</Text>
          ) : (
            coach.assignments.map((a, i) => (
              <View
                key={a.teamStaffId}
                className={`flex-row items-center gap-3 py-2 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
              >
                <View className="h-3 w-3 rounded-full" style={{ backgroundColor: a.teamColor }} />
                <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                  {a.teamName}
                </Text>
                <RoleChip label={t(`staff_role.${a.staffRole}`)} />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
