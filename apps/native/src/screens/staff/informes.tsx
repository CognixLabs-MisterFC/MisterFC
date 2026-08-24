import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getStaffTeamsFromClient,
  getLaunchedCampaignPeriodFromClient,
  clubScopedCacheKey,
  type StaffTeamCard,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { reportDataError } from '@/lib/report-error';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { ListCard, RoleChip } from './hub-parts';
import { DireccionReportPlayersScreen } from '@/screens/direction/report-players-list';

type Data = { period: string | null; teams: StaffTeamCard[] };

/**
 * 19-C — INFORMES del entrenador: estado de los informes de la campaña de SUS equipos.
 * Dispatcher que resuelve, en un solo fetch, el periodo de la campaña LANZADA (19-A: como
 * mucho uno por temporada) y sus equipos (`getStaffTeamsFromClient`, RLS = gate):
 *  · sin campaña lanzada → lo dice (no se hace elegir equipo para nada).
 *  · 0 equipos → lo dice.
 *  · 1 equipo → directo a su listado (sin selector).
 *  · varios (coordinador) → picker mínimo → listado del elegido.
 *
 * El listado reutiliza `DireccionReportPlayersScreen` (presentacional, SOLO estado; misma
 * caché `dir-report-players`, dato idéntico para el mismo club/equipo/periodo). Nada
 * club-wide: solo los equipos del usuario.
 */
export function StaffInformesScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<Data>(
    clubScopedCacheKey('staff-informes', clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !membershipId) return { period: null, teams: [] };
      const [period, teams] = await Promise.all([
        getLaunchedCampaignPeriodFromClient(sb, clubId),
        getStaffTeamsFromClient(sb, { membershipId, clubId }, (e) =>
          reportDataError('staff-informes', e),
        ),
      ]);
      return { period, teams };
    },
  );

  if (loading) return <LoadingScreen />;

  const period = data?.period ?? null;
  const teams = data?.teams ?? [];

  // Sin campaña lanzada: se dice, no se deja vacío ni se hace elegir equipo.
  if (period == null) {
    return (
      <View className="flex-1 bg-white">
        <OfflineBanner show={fromCache} />
        <EmptyState message={t('informes.no_campaign_launched')} />
      </View>
    );
  }

  if (teams.length === 0) {
    return (
      <View className="flex-1 bg-white">
        <OfflineBanner show={fromCache} />
        <EmptyState message={t('mis_equipos.empty')} />
      </View>
    );
  }

  // Un solo equipo: directo a su listado, sin selector.
  if (teams.length === 1) {
    return (
      <DireccionReportPlayersScreen
        teamId={teams[0].teamId}
        period={period}
        teamName={teams[0].name}
      />
    );
  }

  // Varios equipos (coordinador): picker mínimo → listado del elegido.
  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
        <ScreenTitle>{t('mis_equipos.pick_team')}</ScreenTitle>
        {teams.map((team) => (
          <ListCard
            key={team.teamId}
            accent={team.color || accent}
            onPress={() =>
              router.push({
                pathname: '/staff/informes-jugadores',
                params: { teamId: team.teamId, period, teamName: team.name },
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
