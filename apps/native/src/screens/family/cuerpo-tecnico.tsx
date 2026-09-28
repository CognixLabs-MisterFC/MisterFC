import type { ReactNode } from 'react';
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
 *
 * ⚠️ ESTA PANTALLA LA COMPARTEN DOS ÁREAS. La usan la familia (el equipo de su hijo)
 * y dirección (`/direction/equipo-cuerpo-tecnico`). Cualquier cosa de GESTIÓN que se
 * pinte aquí sin condición se la enseña también a los padres.
 *
 * W-3 — por eso «Añadir staff» no se pinta aquí: entra por `action`, y SOLO la ruta
 * de dirección la pasa. Sin `action` la pantalla es exactamente la de antes, así que
 * la de familia no cambia ni hay que tocarla. El defecto es no pintar nada: si
 * alguien añade un área nueva y se olvida de la prop, el fallo es que le falte un
 * botón, no que se filtre.
 *
 * `refreshKey` deja que quien pinta la acción fuerce una recarga tras escribir.
 */
export function CuerpoTecnicoScreen({
  teamId,
  teamName,
  color,
  action,
}: {
  teamId: string | null;
  teamName: string | null;
  color: string | null;
  /**
   * Acción de gestión junto al título. Se le da `refresh` para que pueda recargar
   * la lista después de escribir. Por omisión NO se pinta nada — ver el aviso de
   * arriba sobre las dos áreas.
   */
  action?: (refresh: () => void) => ReactNode;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading, refresh } = useCached<LightTeamStaff[]>(
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
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-xl font-bold text-[#0F1B2E]">
            {t('mi_equipo.nav_staff')}
          </Text>
          {action?.(refresh)}
        </View>
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
