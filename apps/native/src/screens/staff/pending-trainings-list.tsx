import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getStaffTeamsFromClient,
  listStaffTrainingsWithoutAttendanceFromClient,
  listStaffTrainingsWithoutSessionFromClient,
  clubScopedCacheKey,
  type StaffPendingTraining,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { reportDataError } from '@/lib/report-error';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-16 — Lista PARAMETRIZABLE de entrenos pendientes del entrenador. Las dos tareas
 * ("sin pasar lista" y "sin sesión") tienen la MISMA forma —entrenos pendientes de
 * algo, de SUS equipos— así que una sola pantalla las sirve, cambiando el loader y los
 * textos. El loader es el MISMO que alimenta el contador de la tarjeta del inicio → el
 * "X" de la tarjeta y las filas de aquí siempre cuadran.
 *
 * Ambas filas llevan a `/staff/asistencia-sesion?eventId`, que hospeda tanto el marcado
 * de asistencia como la planificación de la sesión (SessionPlanEntry): el entrenador
 * ACTÚA desde ahí. El scope (SUS equipos, temporada activa) lo fija
 * `getStaffTeamsFromClient`; el loader filtra por `team_id IN` esos equipos.
 */
type Variant = 'without_attendance' | 'without_session';

export function StaffPendingTrainingsScreen({ variant }: { variant: Variant }) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;

  const { data, fromCache, loading } = useCached<StaffPendingTraining[]>(
    clubScopedCacheKey(`staff-pending-${variant}`, clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !membershipId) return [];
      const teams = await getStaffTeamsFromClient(
        sb,
        { membershipId, clubId },
        (e) => reportDataError(`staff-pending-${variant}`, e),
      );
      const teamIds = teams.map((tm) => tm.teamId);
      return variant === 'without_attendance'
        ? listStaffTrainingsWithoutAttendanceFromClient(sb, { teamIds })
        : listStaffTrainingsWithoutSessionFromClient(sb, { teamIds });
    },
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <Text className="px-4 pb-2 pt-4 text-xl font-semibold text-[#0F1B2E]">
        {t(`staff_pending.${variant}.title`)}
      </Text>
      {rows.length === 0 ? (
        <EmptyState message={t(`staff_pending.${variant}.empty`)} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/staff/asistencia-sesion',
                  params: { eventId: item.id },
                })
              }
              className="mx-4 my-1 flex-row items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 active:opacity-70"
            >
              <View
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: item.team_color }}
              />
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                  {item.team_name}
                </Text>
                <Text className="text-xs text-zinc-400" numberOfLines={1}>
                  {[new Date(item.starts_at).toLocaleString(), item.category_name]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Text className="text-zinc-300">›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
