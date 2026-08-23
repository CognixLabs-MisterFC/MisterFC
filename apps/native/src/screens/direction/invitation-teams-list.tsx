import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  clubScopedCacheKey,
  listTeamInvitationSummariesFromClient,
  type DireccionTeamInvitationSummary,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

type T = (key: string, values?: Record<string, string>) => string;

/**
 * Línea de desglose de una fila. Sin envíos → "Sin invitaciones enviadas" (la señal que
 * quiere ver dirección: a ese equipo se le olvidó invitar). Con envíos → "N enviadas" y
 * los segmentos no-cero de aceptadas/caducadas/pendientes (plurales ICU del catálogo).
 */
function summaryLine(t: T, r: DireccionTeamInvitationSummary): string {
  if (r.sent === 0) return t('dir_inicio.inv_none_sent');
  const parts = [t('dir_inicio.inv_sent', { count: String(r.sent) })];
  if (r.accepted > 0) parts.push(t('dir_inicio.inv_accepted', { count: String(r.accepted) }));
  if (r.expired > 0) parts.push(t('dir_inicio.inv_expired', { count: String(r.expired) }));
  if (r.pending > 0) parts.push(t('dir_inicio.inv_pending', { count: String(r.pending) }));
  return parts.join(' · ');
}

/**
 * D2-3 nivel 1 — Resumen de invitaciones POR EQUIPO para dirección (SOLO CONSULTA,
 * club-wide). Una fila por equipo de la temporada activa (incluidos los de 0 enviadas)
 * con el desglose enviadas/aceptadas/caducadas/pendientes, más "Sin equipo" si hay
 * invitaciones sin equipo. Ordenado por pendientes desc (a quién perseguir). Fila
 * pulsable → nivel 2 (listado individual del equipo). Ni un botón de acción.
 */
export function DireccionInvitationTeamsScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<DireccionTeamInvitationSummary[]>(
    clubScopedCacheKey('dir-pend-invite-teams', clubId ?? 'none'),
    (sb) =>
      clubId ? listTeamInvitationSummariesFromClient(sb, clubId) : Promise.resolve([]),
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.teamId ?? 'none'}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
        ListHeaderComponent={<ScreenTitle>{t('dir_inicio.inv_teams_title')}</ScreenTitle>}
        ListEmptyComponent={<EmptyState message={t('dir_inicio.list_empty')} />}
        renderItem={({ item }) => {
          const name = item.team_name ?? t('dir_inicio.no_team');
          const onPress = () =>
            router.push({
              pathname: '/direction/pendientes-invitaciones',
              params: item.teamId
                ? { teamId: item.teamId, name: item.team_name ?? '' }
                : { noTeam: '1' },
            });
          return (
            <Pressable
              onPress={onPress}
              className="rounded-2xl border border-zinc-200 p-4 active:opacity-70"
              style={{ borderLeftWidth: 4, borderLeftColor: item.team_color ?? accent }}
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
                  {name}
                </Text>
                <Text className="text-zinc-300">›</Text>
              </View>
              <Text className="mt-1 text-xs text-zinc-500" numberOfLines={2}>
                {summaryLine(t, item)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
