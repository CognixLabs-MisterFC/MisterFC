import { FlatList, Text, View } from 'react-native';
import {
  clubScopedCacheKey,
  listPendingInvitationsFromClient,
  type DireccionPendingInvitation,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

type T = (key: string, values?: Record<string, string>) => string;

/**
 * Fecha de caducidad con nombres de MES del CATÁLOGO (es/en/va), no `toLocaleString`
 * del sistema: la app no usa el idioma del dispositivo. Coherente con el resto.
 */
function formatExpiry(t: T, iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${t(`calendario.date.month.${d.getMonth()}`)} ${d.getFullYear()}`;
}

/**
 * D2-2 — Invitaciones pendientes del club para dirección (SOLO CONSULTA, club-wide).
 * Lista informativa SIN detalle: cada fila muestra a quién se invitó, con qué rol, a
 * qué equipo (si va atada a uno) y cuándo caduca. Filas NO pulsables (no hay a dónde
 * ir). RLS `invitations_select` ya deja al director ver las del club (mig f14k_1).
 */
export function DireccionInvitationsScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<DireccionPendingInvitation[]>(
    clubScopedCacheKey('dir-pend-invites', clubId ?? 'none'),
    (sb) => (clubId ? listPendingInvitationsFromClient(sb, clubId) : Promise.resolve([])),
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
        ListHeaderComponent={<ScreenTitle>{t('dir_inicio.invitations')}</ScreenTitle>}
        ListEmptyComponent={<EmptyState message={t('dir_inicio.list_empty')} />}
        renderItem={({ item }) => {
          const roleAndTeam = [t(`roles.${item.role}`), item.team_name]
            .filter(Boolean)
            .join(' · ');
          return (
            <View className="rounded-2xl border border-zinc-200 p-4">
              <Text className="text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
                {item.email}
              </Text>
              <Text className="mt-1 text-xs text-zinc-500" numberOfLines={1}>
                {roleAndTeam}
              </Text>
              <Text className="text-xs text-zinc-400">
                {`${t('dir_inicio.expires')} · ${formatExpiry(t, item.expires_at)}`}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}
