import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getTeamTrainingsFromClient,
  teamScopedCacheKey,
  type TeamTrainingRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/** Día + hora sin segundos (mismo criterio que el resto de la app: `toLocaleString`). */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * O2 — Entrenamientos del equipo (SOLO LECTURA). Lista TODOS los entrenamientos
 * (con sesión o sin ella). Los que tienen SESIÓN COMPARTIDA llevan indicador (📋) y
 * abren la sesión reutilizando `sesion-detalle`; los que no, abren un detalle con los
 * datos del entrenamiento. Sustituye a la antigua lista de "Sesiones" de Mi equipo.
 * Fetch en core; caché team-scoped.
 */
export function EntrenamientosScreen({
  teamId,
  teamName,
}: {
  teamId: string | null;
  teamName: string | null;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<TeamTrainingRow[]>(
    teamScopedCacheKey('entrenamientos', clubId ?? 'none', teamId ?? 'none'),
    (sb) => {
      if (!clubId || !teamId) return Promise.resolve([]);
      const fromIso = new Date().toISOString().slice(0, 10);
      return getTeamTrainingsFromClient(sb, clubId, [{ id: teamId, name: teamName ?? '' }], fromIso);
    },
  );

  if (!teamId) return <EmptyState message={t('mi_equipo.no_team')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{t('entrenamientos.title')}</Text>
        {teamName ? <Text className="mb-1 text-xs text-zinc-400">{teamName}</Text> : null}
        {rows.length === 0 ? (
          <EmptyState message={t('entrenamientos.empty')} />
        ) : (
          rows.map((r) => (
            <Pressable
              key={r.event_id}
              onPress={() =>
                r.session_id
                  ? router.push({ pathname: '/family/sesion', params: { sessionId: r.session_id } })
                  : router.push({
                      pathname: '/family/entrenamiento',
                      params: {
                        title: r.title ?? '',
                        startsAt: r.starts_at,
                        locationName: r.location_name ?? '',
                      },
                    })
              }
              className="rounded-xl border border-zinc-200 px-3 py-3 active:opacity-70"
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                  {r.title || t('entrenamientos.untitled')}
                </Text>
                {r.session_id ? (
                  <View className="rounded-full bg-emerald-50 px-2 py-0.5">
                    <Text className="text-[11px] font-semibold text-emerald-700">
                      📋 {t('entrenamientos.session_badge')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-xs text-zinc-400">
                {[formatDateTime(r.starts_at), r.location_name].filter(Boolean).join(' · ')}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
