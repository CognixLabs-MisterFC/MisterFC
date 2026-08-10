import { ScrollView, Text, View } from 'react-native';
import {
  getTeamStaffLightFromClient,
  teamScopedCacheKey,
  type LightTeamStaff,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { MisEquiposScreen } from './mis-equipos';
import { RoleChip } from './hub-parts';

/**
 * O2-10a — Cuerpo técnico (ligero) de un equipo: nombre + rol, SIN contacto
 * (`getTeamStaffLightFromClient`, ya en core). Con teamId muestra el staff; sin
 * teamId reusa "Mis equipos" como PICKER. RLS = gate (miembro del club lee).
 * Caché team-scoped (`staff-cuerpo::${clubId}::${teamId}`).
 */
export function TeamStaffScreen({
  teamId,
  name,
  color,
}: {
  teamId: string | null;
  name: string | null;
  color: string | null;
}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const accent = color || theme?.color || BRAND.navy;

  const { data, fromCache, loading } = useCached<LightTeamStaff[]>(
    teamScopedCacheKey('staff-cuerpo', clubId ?? 'none', teamId ?? 'none'),
    async (sb) => {
      if (!teamId) return [];
      return getTeamStaffLightFromClient(sb, [{ id: teamId, name: name ?? '', color: accent }]);
    },
  );

  if (!teamId) return <MisEquiposScreen target="staff" />;
  if (loading) return <LoadingScreen />;
  const members = data?.[0]?.members ?? [];
  if (members.length === 0) return <EmptyState message={t('cuerpo_tecnico.app_empty')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{name ? `${t('cuerpo_tecnico.title')} · ${name}` : t('cuerpo_tecnico.title')}</ScreenTitle>
        <View className="rounded-2xl border border-zinc-200" style={{ borderLeftWidth: 4, borderLeftColor: accent }}>
          {members.map((m, i) => (
            <View
              key={m.team_staff_id}
              className={`flex-row items-center gap-2 px-4 py-3 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
            >
              <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                {m.full_name}
              </Text>
              <RoleChip label={t(`staff_role.${m.staff_role}`)} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
