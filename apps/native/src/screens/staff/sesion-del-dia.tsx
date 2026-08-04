import { ScrollView, Text, View } from 'react-native';
import {
  getStaffTeamsFromClient,
  getSharedSessionsForTeamsFromClient,
  clubScopedCacheKey,
  type PlayerSharedSessionRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';
import { ListCard } from './hub-parts';

/**
 * O2-10a — Sesiones (publicadas) de los equipos del staff, próximas desde hoy
 * (`getSharedSessionsForTeamsFromClient`, D1). SOLO LECTURA — crear/editar sesiones
 * es WEB-ONLY (no se porta). Resuelve los equipos con `getStaffTeamsFromClient`.
 * Caché club-scoped (`staff-sessions::${clubId}`).
 */
const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function SesionDelDiaScreen() {
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<PlayerSharedSessionRow[]>(
    clubScopedCacheKey('staff-sessions', clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !membershipId) return [];
      const teams = await getStaffTeamsFromClient(sb, { membershipId, clubId });
      if (teams.length === 0) return [];
      return getSharedSessionsForTeamsFromClient(
        sb,
        clubId,
        teams.map((tm) => ({ id: tm.teamId, name: tm.name })),
        todayIso(),
        50,
      );
    },
  );

  if (loading) return <LoadingScreen />;
  const sessions = data ?? [];
  if (sessions.length === 0) return <EmptyState message={t('sesion_dia.empty')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('sesion_dia.title')}</ScreenTitle>
        {sessions.map((s) => (
          <ListCard key={s.id} accent={accent}>
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
                {s.title ?? t('sesion_dia.untitled')}
              </Text>
              {s.total_minutes != null ? (
                <Text className="text-xs text-zinc-400 tabular-nums">{s.total_minutes}′</Text>
              ) : null}
            </View>
            <Text className="mt-0.5 text-xs text-zinc-400">
              {s.session_date} · {s.team_name}
            </Text>
          </ListCard>
        ))}
      </ScrollView>
    </View>
  );
}
