import { useMemo } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getTeamPlaybookFromClient,
  teamScopedCacheKey,
  STRATEGY_TYPES,
  type PlaybookRow,
  type StrategyType,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { SignalIcon } from '@/ui/signal-icon';

/** Clave del grupo de jugadas sin categoría (strategy_type = null). Va al final. */
const UNCATEGORIZED = '_none' as const;
type GroupKey = StrategyType | typeof UNCATEGORIZED;

type PlayGroup = { key: GroupKey; rows: PlaybookRow[] };

/**
 * O2-5 D2 — Playbook: listado de jugadas COMPARTIDAS con la familia del equipo
 * (coherente con D1: teamId por navegación desde Mi equipo). SOLO LECTURA; la RLS
 * de team_plays es el gate. Caché team-scoped. Cada jugada abre el visor animado.
 *
 * Punto 5 QA — la lista se AGRUPA por categoría (`strategy_type`: córner, falta,
 * saque de banda, saque de centro) en el orden canónico de `STRATEGY_TYPES`, con
 * las sin categoría al final. Cada jugada muestra SU SEÑA (el monigote de core) a
 * la izquierda. Se elimina el número de frames (no aporta al jugador).
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

  // Agrupa por categoría manteniendo el orden canónico de STRATEGY_TYPES y dejando
  // el grupo "sin categoría" el último. Dentro del grupo se conserva el orden del
  // loader (updated_at desc). Solo se emiten los grupos con jugadas.
  const groups: PlayGroup[] = useMemo(() => {
    const rows = data ?? [];
    const byKey = new Map<GroupKey, PlaybookRow[]>();
    for (const p of rows) {
      const key: GroupKey = p.strategy_type ?? UNCATEGORIZED;
      const list = byKey.get(key);
      if (list) list.push(p);
      else byKey.set(key, [p]);
    }
    const ordered: GroupKey[] = [...STRATEGY_TYPES, UNCATEGORIZED];
    return ordered
      .filter((k) => byKey.has(k))
      .map((k) => ({ key: k, rows: byKey.get(k)! }));
  }, [data]);

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
          groups.map((g) => (
            <View key={g.key} className="gap-2">
              <Text className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {g.key === UNCATEGORIZED
                  ? t('playbook.uncategorized')
                  : t(`jugadas.strategy.${g.key}`)}
              </Text>
              {g.rows.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => router.push({ pathname: '/family/jugada', params: { playId: p.id } })}
                  className="flex-row items-center gap-3 rounded-xl border border-zinc-200 px-3 py-3 active:opacity-70"
                >
                  <View className="h-8 w-8 items-center justify-center">
                    {p.signal_id ? <SignalIcon signalId={p.signal_id} size={28} /> : null}
                  </View>
                  <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                    {p.name ?? t('playbook.untitled')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
