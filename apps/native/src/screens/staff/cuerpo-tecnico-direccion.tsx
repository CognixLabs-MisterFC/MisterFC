import { ScrollView, Text, View } from 'react-native';
import {
  getTeamStaffLightFromClient,
  teamScopedCacheKey,
  type LightTeamStaff,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActiveStaffTeam } from '@/auth/active-staff-team';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { StaffTeamSelector } from '@/ui/staff-team-selector';
import { RoleChip } from './hub-parts';
import { t } from '@/i18n';

/**
 * O2-10b-2 — CUERPO TÉCNICO DE DIRECCIÓN (coordinador, SOLO LECTURA). Directorio del
 * staff del EQUIPO ACTIVO (selector global). Reutiliza la lectura team-scoped de core
 * `getTeamStaffLightFromClient` (RLS `team_staff_select_member`, acotada a los equipos
 * del coordinador porque el selector solo ofrece sus team_staff). NADA de gestión
 * (mover staff es web). Caché team-scoped (`coord-cuerpo::${clubId}::${teamId}`).
 */
export function CuerpoTecnicoDireccionScreen() {
  const { activeClub } = useApp();
  const { loading: teamLoading, activeTeam } = useActiveStaffTeam();
  const clubId = activeClub?.club.id ?? null;
  const teamId = activeTeam?.teamId ?? null;

  const { data, fromCache, loading } = useCached<LightTeamStaff[]>(
    teamScopedCacheKey('coord-cuerpo', clubId ?? 'none', teamId ?? 'none'),
    (sb) =>
      activeTeam
        ? getTeamStaffLightFromClient(sb, [
            { id: activeTeam.teamId, name: activeTeam.name, color: activeTeam.color },
          ])
        : Promise.resolve([]),
  );

  if (teamLoading) return <LoadingScreen />;
  if (!activeTeam) return <EmptyState message={t('cuerpo_direccion.no_team')} />;
  if (loading) return <LoadingScreen />;

  const members = data?.[0]?.members ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <StaffTeamSelector />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('cuerpo_direccion.title')}</ScreenTitle>
        {members.length === 0 ? (
          <EmptyState message={t('cuerpo_direccion.empty')} />
        ) : (
          <View className="rounded-2xl border border-zinc-200">
            {members.map((m, i) => (
              <View
                key={m.team_staff_id}
                className={`flex-row items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
              >
                <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                  {m.full_name}
                </Text>
                <RoleChip label={t(`staff_role.${m.staff_role}`)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
