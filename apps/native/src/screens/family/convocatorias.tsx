import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getPlayerCallupsFromClient,
  playerScopedCacheKey,
  type PlayerCallupRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { ChildSelector } from '@/ui/child-selector';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-5 E1 — Convocatorias del HIJO ACTIVO (próximas + histórico), SOLO LECTURA en
 * este listado; la respuesta se da en el detalle. El fetch vive en core
 * (getPlayerCallupsFromClient, misma query + RLS que la web). Caché player-scoped:
 * cambiar de hijo → key distinta → nunca se sirve el listado del otro.
 */
export function ConvocatoriasScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<PlayerCallupRow[]>(
    playerScopedCacheKey('convocatorias', clubId ?? 'none', playerId ?? 'none'),
    async (sb) => {
      if (!clubId || !playerId) return [];
      // Ventana: un año atrás (histórico) → dos meses adelante (próximas).
      const now = Date.now();
      return getPlayerCallupsFromClient(sb, clubId, [playerId], {
        fromIso: new Date(now - 365 * 86_400_000).toISOString(),
        toIso: new Date(now + 60 * 86_400_000).toISOString(),
      });
    },
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;

  const rows = data ?? [];
  const nowIso = new Date().toISOString();
  // Límite 5 POR SECCIÓN: las 5 próximas más cercanas (asc) y las 5 anteriores
  // más recientes (desc). Un tope global de 5 descuadraría según el momento de la
  // temporada (5 pasadas y 0 próximas, o al revés).
  const upcoming = rows.filter((r) => r.starts_at >= nowIso).slice(0, 5);
  const past = rows.filter((r) => r.starts_at < nowIso).reverse().slice(0, 5);

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('convocatorias.family_title')}</ScreenTitle>

        {rows.length === 0 ? (
          <EmptyState message={t('convocatorias.family_empty')} />
        ) : (
          <>
            <Section title={t('convocatorias.upcoming')}>
              {upcoming.length === 0 ? (
                <Text className="text-sm text-zinc-500">{t('convocatorias.upcoming_empty')}</Text>
              ) : (
                upcoming.map((r) => (
                  <CallupRow
                    key={r.event_id}
                    row={r}
                    accent={accent}
                    onPress={() =>
                      router.push({ pathname: '/family/convocatoria', params: { eventId: r.event_id } })
                    }
                  />
                ))
              )}
            </Section>

            {past.length > 0 ? (
              <Section title={t('convocatorias.past')}>
                {past.map((r) => (
                  <CallupRow
                    key={r.event_id}
                    row={r}
                    accent={accent}
                    onPress={() =>
                      router.push({ pathname: '/family/convocatoria', params: { eventId: r.event_id } })
                    }
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CallupRow({
  row,
  accent,
  onPress,
}: {
  row: PlayerCallupRow;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="border-b border-zinc-100 py-3 active:opacity-70"
    >
      <View className="flex-row items-center gap-2">
        <View className="h-3 w-3 rounded-full" style={{ backgroundColor: row.team_color }} />
        <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
          {row.title}
          {row.opponent_name ? ` · ${row.opponent_name}` : ''}
        </Text>
        <ResponseChip status={row.my_response} accent={accent} />
      </View>
      <View className="mt-1 flex-row items-center gap-2">
        <Text className="flex-1 text-xs text-zinc-400" numberOfLines={1}>
          {[new Date(row.starts_at).toLocaleString(), row.team_name].filter(Boolean).join(' · ')}
        </Text>
        {row.my_decision ? <DecisionBadge decision={row.my_decision} /> : null}
      </View>
    </Pressable>
  );
}

function ResponseChip({
  status,
  accent,
}: {
  status: 'yes' | 'maybe' | 'no' | null;
  accent: string;
}) {
  const t = useTranslations('');
  const label =
    status === 'yes'
      ? t('convocatorias.response.yes')
      : status === 'maybe'
        ? t('convocatorias.resp_maybe')
        : status === 'no'
          ? t('convocatorias.response.no')
          : t('convocatorias.resp_pending');
  const bg =
    status === 'yes' ? '#16a34a' : status === 'no' ? '#dc2626' : status === 'maybe' ? '#d97706' : accent;
  const faded = status == null;
  return (
    <View
      className="rounded-full px-2 py-0.5"
      style={faded ? { borderWidth: 1, borderColor: '#e4e4e7' } : { backgroundColor: bg }}
    >
      <Text className={faded ? 'text-[10px] text-zinc-500' : 'text-[10px] font-semibold text-white'}>
        {label}
      </Text>
    </View>
  );
}

function DecisionBadge({ decision }: { decision: 'called_up' | 'discarded' }) {
  const t = useTranslations('');
  const called = decision === 'called_up';
  return (
    <View
      className="rounded px-1.5 py-0.5"
      style={{ backgroundColor: called ? '#dcfce7' : '#fee2e2' }}
    >
      <Text className="text-[10px] font-semibold" style={{ color: called ? '#166534' : '#991b1b' }}>
        {called ? t('convocatorias.decision.called_up') : t('convocatorias.decision_discarded')}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</Text>
      {children}
    </View>
  );
}
