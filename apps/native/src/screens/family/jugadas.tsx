import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getTeamPlaybookFromClient,
  teamScopedCacheKey,
  type PlaybookRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-5 D2 — Playbook: listado de jugadas COMPARTIDAS con la familia del equipo
 * (coherente con D1: teamId por navegación desde Mi equipo). SOLO LECTURA; la RLS
 * de team_plays es el gate. Caché team-scoped. Cada jugada abre el visor animado.
 */
export function JugadasScreen({ teamId, teamName }: { teamId: string | null; teamName: string | null }) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<PlaybookRow[]>(
    teamScopedCacheKey('playbook', clubId ?? 'none', teamId ?? 'none'),
    (sb) => (teamId ? getTeamPlaybookFromClient(sb, teamId) : Promise.resolve([])),
  );

  if (!teamId) return <EmptyState message={t('mi_equipo.no_team')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{t('playbook.title')}</Text>
        {teamName ? <Text className="mb-1 text-xs text-zinc-400">{teamName}</Text> : null}
        {rows.length === 0 ? (
          <EmptyState message={t('playbook.empty')} />
        ) : (
          rows.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push({ pathname: '/family/jugada', params: { playId: p.id } })}
              className="flex-row items-center justify-between rounded-xl border border-zinc-200 px-3 py-3 active:opacity-70"
            >
              <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                {p.name ?? t('playbook.untitled')}
              </Text>
              <Text className="text-[11px] text-zinc-400">
                {t('mi_equipo.frames', { count: String(p.frame_count) })}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
