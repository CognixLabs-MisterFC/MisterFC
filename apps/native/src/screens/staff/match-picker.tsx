import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getStaffSeasonMatchesFromClient,
  getActiveSeasonStartIsoFromClient,
  clubScopedCacheKey,
  type StaffSeasonMatch,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { reportDataError } from '@/lib/report-error';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2 QA (E6/E7) — SELECTOR de partido para Alineación y Post-partido. Esas pantallas
 * exigen `eventId` y, abiertas desde el MENÚ (sin él), eran un callejón sin salida.
 * Aquí se interpone la lista de partidos de la TEMPORADA (pasados y futuros) de los
 * equipos del staff — mismo patrón que `MisEquiposScreen` para las consultas por
 * equipo. Al tocar un partido se navega a la pantalla destino con su `eventId`.
 */
const ROUTE_FOR: Record<'alineacion' | 'post-partido', string> = {
  alineacion: '/staff/alineacion',
  'post-partido': '/staff/post-partido',
};

export function MatchPickerScreen({ target }: { target: 'alineacion' | 'post-partido' }) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<StaffSeasonMatch[]>(
    clubScopedCacheKey('staff-season-matches', clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !membershipId) return [];
      const fromIso = await getActiveSeasonStartIsoFromClient(sb, clubId);
      return getStaffSeasonMatchesFromClient(sb, { clubId, membershipId, fromIso }, (e) =>
        reportDataError('staff-season-matches', e),
      );
    },
  );

  if (loading) return <LoadingScreen />;
  const matches = data ?? [];

  const open = (m: StaffSeasonMatch) =>
    router.push({ pathname: ROUTE_FOR[target], params: { eventId: m.eventId } });

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('match_picker.title')}</ScreenTitle>
        {matches.length === 0 ? (
          <EmptyState message={t('match_picker.empty')} />
        ) : (
          matches.map((m) => (
            <Pressable
              key={m.eventId}
              onPress={() => open(m)}
              className="rounded-2xl border border-zinc-200 p-4 active:bg-zinc-50"
              style={{ borderLeftWidth: 4, borderLeftColor: accent }}
            >
              <Text className="text-base font-semibold text-[#0F1B2E]" numberOfLines={1}>
                {m.teamName}
                {m.opponentName ? `  ${t('common.vs')}  ${m.opponentName}` : ''}
              </Text>
              <Text className="mt-0.5 text-xs text-zinc-400" numberOfLines={1}>
                {new Date(m.startsAt).toLocaleString(undefined, {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {m.categoryName ? ` · ${m.categoryName}` : ''}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
