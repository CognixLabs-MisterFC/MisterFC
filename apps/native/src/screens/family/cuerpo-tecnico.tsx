import { ScrollView, Text, View } from 'react-native';
import {
  getTeamStaffLightFromClient,
  teamScopedCacheKey,
  type LightTeamStaff,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/** Etiqueta i18n del rol de staff (fallback = el propio código). */
function roleLabel(role: string, t: (key: string) => string): string {
  return t(`staff_role.${role}`);
}

/**
 * O2-5 D1 — Cuerpo técnico ligero: nombre + rol del staff del equipo (SIN contacto,
 * es para familias/menores). Fetch en core (`getTeamStaffLightFromClient`), aquí con
 * UN equipo (el de la navegación). Caché team-scoped.
 */
export function CuerpoTecnicoScreen({
  teamId,
  teamName,
  color,
}: {
  teamId: string | null;
  teamName: string | null;
  color: string | null;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<LightTeamStaff[]>(
    teamScopedCacheKey('staff', clubId ?? 'none', teamId ?? 'none'),
    (sb) =>
      teamId
        ? getTeamStaffLightFromClient(sb, [
            { id: teamId, name: teamName ?? '', color: color ?? '#000' },
          ])
        : Promise.resolve([]),
  );

  if (!teamId) return <EmptyState message={t('mi_equipo.family_no_team')} />;
  if (loading) return <LoadingScreen />;
  const members = data?.[0]?.members ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{t('mi_equipo.nav_staff')}</Text>
        {teamName ? <Text className="mb-1 text-xs text-zinc-400">{teamName}</Text> : null}
        {members.length === 0 ? (
          <EmptyState message={t('mi_equipo.staff_empty')} />
        ) : (
          members.map((m) => (
            <View key={m.team_staff_id} className="rounded-xl border border-zinc-200 px-3 py-2">
              <Text className="text-sm font-medium text-[#0F1B2E]">{m.full_name}</Text>
              <Text className="text-[11px] text-zinc-400">{roleLabel(m.staff_role, t)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
