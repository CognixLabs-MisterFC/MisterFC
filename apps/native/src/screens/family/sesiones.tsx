import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getSharedSessionsForTeamsFromClient,
  teamScopedCacheKey,
  type PlayerSharedSessionRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-5 D1 — Sesiones publicadas (visibility='team') del equipo, próximas (incluido
 * hoy), SOLO LECTURA. Fetch en core; caché team-scoped. Cada sesión abre el detalle.
 */
export function SesionesScreen({ teamId, teamName }: { teamId: string | null; teamName: string | null }) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<PlayerSharedSessionRow[]>(
    teamScopedCacheKey('sesiones', clubId ?? 'none', teamId ?? 'none'),
    (sb) => {
      if (!clubId || !teamId) return Promise.resolve([]);
      const todayIso = new Date().toISOString().slice(0, 10);
      return getSharedSessionsForTeamsFromClient(
        sb,
        clubId,
        [{ id: teamId, name: teamName ?? '' }],
        todayIso,
      );
    },
  );

  if (!teamId) return <EmptyState message={t('mi_equipo.no_team')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{t('mi_equipo.nav_sesiones')}</Text>
        {teamName ? <Text className="mb-1 text-xs text-zinc-400">{teamName}</Text> : null}
        {rows.length === 0 ? (
          <EmptyState message={t('mi_equipo.sesiones_empty')} />
        ) : (
          rows.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => router.push({ pathname: '/family/sesion', params: { sessionId: s.id } })}
              className="rounded-xl border border-zinc-200 px-3 py-3 active:opacity-70"
            >
              <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                {s.title ?? t('mi_equipo.session.untitled')}
              </Text>
              <Text className="text-xs text-zinc-400">
                {[
                  new Date(`${s.session_date}T00:00:00`).toLocaleDateString(),
                  s.total_minutes != null ? t('mi_equipo.session.minutes', { count: String(s.total_minutes) }) : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
