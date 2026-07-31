import { useState } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';
import {
  getPlayerFichaFromClient,
  playerScopedCacheKey,
  type PlayerFicha,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { ChildSelector } from '@/ui/child-selector';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/**
 * O2-5 C1 — Mi ficha (expediente deportivo del HIJO ACTIVO, SOLO LECTURA):
 * identidad, stats/ratios, asistencia, valoraciones y carrera. Todo el fetch +
 * cálculo viene de core (`getPlayerFichaFromClient`); aquí solo se pinta. Caché
 * PLAYER-SCOPED (ficha::clubId::playerId::season). Foto = iniciales (C2). Badges se
 * evalúan aparte (dependen del roster del equipo).
 */
export function MiFichaScreen() {
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;
  const [season, setSeason] = useState<string | null>(null);

  const { data, fromCache, loading } = useCached<PlayerFicha | null>(
    `${playerScopedCacheKey('ficha', clubId ?? 'none', playerId ?? 'none')}::${season ?? 'def'}`,
    (sb) =>
      playerId ? getPlayerFichaFromClient(sb, playerId, { season }) : Promise.resolve(null),
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('ficha.empty')} />;

  const name = activePlayer?.name ?? '';
  const initials = (data.identity.firstName?.[0] ?? '') + (data.identity.lastName?.[0] ?? '');
  const s = data.stats;
  const r = data.ratios;
  const att = data.attendance;

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        {/* Cabecera de identidad (iniciales; foto es C2). */}
        <View className="flex-row items-center gap-3">
          <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
            <Text className="text-lg font-bold text-white">{initials.toUpperCase() || '·'}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xl font-bold text-[#0F1B2E]" numberOfLines={1}>{name}</Text>
            <Text className="text-xs text-zinc-400">
              {[
                data.identity.dorsal != null ? `#${data.identity.dorsal}` : null,
                ageText(data.identity.dateOfBirth),
                data.identity.positionMain,
                data.identity.foot,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* Temporadas */}
        {data.seasons.length > 1 ? (
          <View className="flex-row flex-wrap gap-2">
            {data.seasons.map((sea) => {
              const on = sea === data.activeSeason;
              return (
                <Pressable
                  key={sea}
                  onPress={() => setSeason(sea)}
                  className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
                  style={on ? { backgroundColor: accent } : undefined}
                >
                  <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>{sea}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Stats de la temporada */}
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
          <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
            <Ratio label={t('ficha.goals_per_match')} v={r.goalsPerMatch} />
            <Ratio label={t('ficha.minutes_per_match')} v={r.minutesPerMatch} />
            <Ratio label={t('ficha.start_rate')} v={r.startRate} pct />
          </View>
        </Section>

        {/* Asistencia */}
        <Section title={t('ficha.attendance')}>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-zinc-500">{t('ficha.attendance_pct')}</Text>
            <Text className="text-lg font-bold text-[#0F1B2E]">{pct(att.presentPct)}</Text>
          </View>
          <Grid
            items={[
              [t('ficha.att_present'), String(att.perBucket.present)],
              [t('ficha.att_justified'), String(att.perBucket.justified)],
              [t('ficha.att_unjustified'), String(att.perBucket.unjustified)],
              [t('ficha.att_partial'), String(att.perBucket.partial)],
            ]}
          />
        </Section>

        {/* Valoraciones */}
        {data.evaluations.length > 0 ? (
          <Section title={t('ficha.evaluations')}>
            {data.evaluations.map((e) => (
              <View key={e.eventId} className="border-b border-zinc-100 py-2">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                    {e.label}{e.isMvp ? ' · MVP' : ''}
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

        {/* Carrera */}
        {data.career.bySeason.length > 0 ? (
          <Section title={t('ficha.career')}>
            {data.career.bySeason.map((cs) => (
              <View key={cs.season} className="flex-row items-center justify-between border-b border-zinc-100 py-1.5">
                <Text className="text-sm text-[#0F1B2E]">{cs.season}</Text>
                <Text className="text-xs text-zinc-500">
                  {`${cs.stats.matches} ${t('ficha.matches_short')} · ${cs.stats.goals} ${t('ficha.goals_short')}${cs.rating != null ? ` · ${cs.rating.toFixed(1)}★` : ''}`}
                </Text>
              </View>
            ))}
            <View className="mt-1 flex-row items-center justify-between pt-1">
              <Text className="text-sm font-semibold text-[#0F1B2E]">{t('ficha.career_total')}</Text>
              <Text className="text-xs font-semibold text-zinc-600">
                {`${data.career.totals.stats.matches} ${t('ficha.matches_short')} · ${data.career.totals.stats.goals} ${t('ficha.goals_short')}`}
              </Text>
            </View>
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ageText(dob: string | null): string | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return `${age} ${t('ficha.years')}`;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
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
          <Text className="text-[10px] text-zinc-400" numberOfLines={1}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function Ratio({ label, v, pct: isPct }: { label: string; v: number | null; pct?: boolean }) {
  const text = v == null ? '—' : isPct ? `${Math.round(v * 100)}%` : v.toFixed(2);
  return (
    <Text className="text-xs text-zinc-500">
      {label}: <Text className="font-semibold text-[#0F1B2E]">{text}</Text>
    </Text>
  );
}
