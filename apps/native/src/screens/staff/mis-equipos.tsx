import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getStaffTeamsFromClient,
  clubScopedCacheKey,
  type StaffTeamCard,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { reportDataError } from '@/lib/report-error';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { ListCard, RoleChip } from './hub-parts';

/**
 * O2-10a — "Mis equipos" del cuerpo técnico: equipos donde el usuario es staff
 * (core `getStaffTeamsFromClient`, RLS = gate). Es la ENTRADA a las consultas por
 * equipo: al tocar un equipo se navega a su destino (`target`) con el teamId
 * (patrón asistencia 7a). Reusado como PICKER cuando se entra a estadísticas /
 * cuerpo técnico sin teamId (no hay selector global — eso es del coordinador, 10b).
 * Caché club-scoped (`staff-teams.${clubId}`).
 */
export type TeamTarget = 'detail' | 'stats' | 'staff' | 'anuncios';

const ROUTE_FOR: Record<TeamTarget, string> = {
  detail: '/staff/equipo',
  stats: '/staff/estadisticas-equipo',
  staff: '/staff/cuerpo-tecnico-ligero',
  anuncios: '/staff/anuncios',
};

export function MisEquiposScreen({ target = 'detail' }: { target?: TeamTarget }) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<StaffTeamCard[]>(
    clubScopedCacheKey('staff-teams', clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !membershipId) return [];
      return getStaffTeamsFromClient(sb, { membershipId, clubId }, (e) =>
        reportDataError('staff-teams', e),
      );
    },
  );

  const open = (team: StaffTeamCard) => {
    router.push({
      pathname: ROUTE_FOR[target],
      params: { teamId: team.teamId, name: team.name, color: team.color },
    });
  };

  if (loading) return <LoadingScreen />;
  const teams = data ?? [];
  if (teams.length === 0) return <EmptyState message={t('mis_equipos.empty')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
        <ScreenTitle>{t(target === 'detail' ? 'mis_equipos.title' : 'mis_equipos.pick_team')}</ScreenTitle>
        {teams.map((team) => (
          <ListCard key={team.teamId} accent={team.color || accent} onPress={() => open(team)}>
            <View className="flex-row items-center gap-2">
              <View className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color || accent }} />
              <Text className="flex-1 text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
                {team.name}
              </Text>
              <RoleChip label={t(`staff_role.${team.staffRole}`)} />
            </View>
            <Text className="mt-0.5 text-xs text-zinc-400">
              {team.categoryName} · {team.format}
            </Text>
          </ListCard>
        ))}
      </ScrollView>
    </View>
  );
}
