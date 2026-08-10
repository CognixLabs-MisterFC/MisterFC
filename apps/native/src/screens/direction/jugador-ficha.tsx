import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  getPlayerFichaFromClient,
  playerScopedCacheKey,
  formatPlayerName,
  type PlayerFicha,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-11a-2 — FICHA de un jugador (DIRECCIÓN, CLUB-WIDE, SOLO LECTURA). Reutiliza el
 * mismo read de core que "Mi ficha" de familia (`getPlayerFichaFromClient`: identidad
 * + stats + asistencia + valoraciones + carrera); aquí solo se pinta, con el playerId
 * del parámetro (sin selector de hijo — dirección no monta ActivePlayerProvider).
 * NADA de edición (es web). Caché player-scoped.
 */
export function DireccionJugadorFichaScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { playerId, name } = useLocalSearchParams<{ playerId?: string; name?: string }>();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<PlayerFicha | null>(
    playerScopedCacheKey('dir-ficha', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getPlayerFichaFromClient(sb, playerId) : Promise.resolve(null)),
  );

  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('ficha.empty')} />;

  const title =
    name ?? formatPlayerName(data.identity.firstName ?? '', data.identity.lastName);
  const s = data.stats;
  const att = data.attendance;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <View>
          <ScreenTitle>{title}</ScreenTitle>
          <Text className="mt-0.5 text-xs text-zinc-400">
            {[
              data.identity.dorsal != null ? `#${data.identity.dorsal}` : null,
              data.identity.positionMain,
              data.identity.foot,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        <Section title={`${t('ficha.stats')}${data.activeSeason ? ` · ${data.activeSeason}` : ''}`}>
          <Grid
            items={[
              [t('ficha.matches'), String(s.matches)],
              [t('ficha.starts'), String(s.starts)],
              [t('ficha.minutes'), String(s.minutesPlayed)],
              [t('ficha.goals'), String(s.goals)],
              [t('ficha.assists'), String(s.assists)],
              [t('ficha.shots'), String(s.shots)],
              [t('ficha.yellow'), String(s.yellowCards)],
              [t('ficha.red'), String(s.redCards)],
            ]}
          />
        </Section>

        <Section title={t('ficha.attendance')}>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-zinc-500">{t('ficha.attendance_pct')}</Text>
            <Text className="text-lg font-bold text-[#0F1B2E]">
              {att.presentPct == null ? '—' : `${Math.round(att.presentPct * 100)}%`}
            </Text>
          </View>
        </Section>

        {data.evaluations.length > 0 ? (
          <Section title={t('ficha.evaluations')}>
            {data.evaluations.map((e) => (
              <View key={e.eventId} className="border-b border-zinc-100 py-2">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                    {e.label}
                    {e.isMvp ? ' · MVP' : ''}
                  </Text>
                  <Text className="text-sm font-bold" style={{ color: accent }}>
                    {e.rating != null ? e.rating.toFixed(1) : '—'}
                  </Text>
                </View>
                {e.comment ? <Text className="mt-0.5 text-xs text-zinc-500">{e.comment}</Text> : null}
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
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

function Grid({ items }: { items: [string, string][] }) {
  return (
    <View className="flex-row flex-wrap">
      {items.map(([label, value]) => (
        <View key={label} className="w-1/4 py-1.5">
          <Text className="text-lg font-bold text-[#0F1B2E] tabular-nums">{value}</Text>
          <Text className="text-[10px] text-zinc-400" numberOfLines={1}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
