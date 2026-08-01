import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  getMatchDetailFromClient,
  getFormation,
  matchPhase,
  eventScopedCacheKey,
  type MatchDetail,
  type DetailFieldPlayer,
  type ClockPeriod,
  type MatchPhaseKind,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/** Polling de marcador/timeline en vivo (ms) — consistente con el listado (B1). */
const LIVE_POLL_MS = 15_000;

const LIVE_PHASES: ReadonlySet<MatchPhaseKind> = new Set([
  'first_half',
  'second_half',
  'extra_time',
]);

/** Eventos que se listan en el timeline (fase de partido). */
const LISTED_EVENTS = new Set([
  'goal', 'penalty', 'assist', 'yellow_card', 'red_card',
  'substitution', 'corner', 'foul', 'offside', 'shot',
]);

/** "Ahora" que tickea cada segundo cuando el partido está en vivo (para el reloj). */
function useTickingNow(active: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Fallback de "ahora" sin ticking: arranque del periodo en curso (elapsed 0). */
function frozenNow(periods: ClockPeriod[]): number {
  const running = periods.find((p) => p.running && p.lastStartedAt);
  return running?.lastStartedAt ? Date.parse(running.lastStartedAt) : 0;
}

/**
 * O2-5 B2 — DETALLE de un directo (familia, SOLO LECTURA): marcador, fase/reloj en
 * vivo, campo con la alineación y timeline de eventos. Con red hace polling (en
 * vivo); sin red muestra el último estado conocido (banner "sin conexión"). El
 * cálculo de fase/marcador viene de core (matchPhase/computeScore); aquí solo se
 * pinta.
 */
export function DirectoDetalleScreen({
  eventId,
  clubId: clubIdProp,
  viewerIsSpectator = false,
  cacheKeyPrefix = 'directo',
}: {
  eventId: string | null;
  /** O2-6 — clubId explícito (seguidor: el del jugador seguido). Familia lo omite
   *  → usa el club activo (comportamiento idéntico). */
  clubId?: string | null;
  /** O2-6 — el seguidor resuelve nombres por `players_sporting` (no lee `players`). */
  viewerIsSpectator?: boolean;
  /** O2-6 — prefijo de caché (seguidor: `spec-directo`); familia lo omite. */
  cacheKeyPrefix?: string;
}) {
  const { activeClub, theme } = useApp();
  const clubId = clubIdProp !== undefined ? clubIdProp : activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<MatchDetail | null>(
    eventScopedCacheKey(cacheKeyPrefix, eventId ?? 'none'),
    (sb) =>
      clubId && eventId
        ? getMatchDetailFromClient(sb, clubId, eventId, { viewerIsSpectator })
        : Promise.resolve(null),
  );

  const isLive = data?.status === 'live';
  const now = useTickingNow(!!isLive);

  // Polling en vivo: con red refresca (y cachea el último estado); sin red el
  // fetchCached devuelve la caché. No se sirve stale online.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [isLive, refresh]);

  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('directo.not_available')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <Scoreboard detail={data} accent={accent} nowMs={now} />
        <FieldCard detail={data} />
        <StatsCard detail={data} />
        <EventsCard detail={data} />
      </ScrollView>
    </View>
  );
}

function Scoreboard({
  detail,
  accent,
  nowMs,
}: {
  detail: MatchDetail;
  accent: string;
  nowMs: number;
}) {
  const isLive = detail.status === 'live';
  const { phase, minute, addedTime } = matchPhase({
    status: detail.status,
    periods: detail.periods,
    halfDurationMinutes: detail.halfDurationMinutes,
    nowMs: isLive ? nowMs : frozenNow(detail.periods),
  });
  const phaseLabel = t(`directo.phase.${phase}`);
  const minuteText =
    isLive && LIVE_PHASES.has(phase)
      ? addedTime > 0
        ? t('directo.minute_added', { minute: String(minute), added: String(addedTime) })
        : t('directo.minute', { minute: String(minute) })
      : phaseLabel;

  return (
    <View
      className="rounded-2xl border border-zinc-200 p-4"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <View className="flex-row items-center justify-center gap-2">
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: detail.teamColor || accent }} />
        <Text className="text-xs text-zinc-400">{detail.categoryName}</Text>
      </View>
      <View className="mt-1 flex-row items-center justify-center gap-2">
        <Text className="text-lg font-bold text-[#0F1B2E]" numberOfLines={1}>
          {detail.teamName}
        </Text>
        <Text className="text-2xl font-extrabold text-[#0F1B2E] tabular-nums">
          {detail.goalsOwn} - {detail.goalsRival}
        </Text>
        <Text className="text-lg font-bold text-[#0F1B2E]" numberOfLines={1}>
          {detail.opponentName ?? ''}
        </Text>
      </View>
      <View className="mt-2 flex-row items-center justify-center gap-2">
        {isLive ? (
          <View className="rounded-full bg-red-500 px-2 py-0.5">
            <Text className="text-[10px] font-bold text-white">{t('directo.live')}</Text>
          </View>
        ) : null}
        <Text className="text-sm text-zinc-500 tabular-nums">{minuteText}</Text>
      </View>
    </View>
  );
}

function FieldCard({ detail }: { detail: MatchDetail }) {
  const hasLineup = detail.hasLineup && detail.fieldPlayers.length > 0;
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {t('directo.field')}
      </Text>
      {hasLineup ? (
        <Pitch detail={detail} />
      ) : (
        <Text className="py-6 text-center text-sm text-zinc-400">{t('directo.no_lineup')}</Text>
      )}
    </View>
  );
}

/** Campo vertical con los titulares posicionados por xPct/yPct (0–100). */
function Pitch({ detail }: { detail: MatchDetail }) {
  const placed = useMemo(() => {
    const formation = getFormation(detail.formationCode);
    return detail.fieldPlayers.map((p) => {
      const slot = formation?.slots.find((s) => s.code === p.positionCode);
      const x = p.xPct ?? slot?.xPct ?? 50;
      const y = p.yPct ?? slot?.yPct ?? 50;
      return { player: p, x, y };
    });
  }, [detail.fieldPlayers, detail.formationCode]);

  return (
    <View
      className="w-full overflow-hidden rounded-xl"
      style={{ aspectRatio: 0.66, backgroundColor: '#15803d' }}
    >
      {/* Líneas simples del campo */}
      <View
        className="absolute rounded-full border-2"
        style={{ width: '30%', aspectRatio: 1, top: '42%', left: '35%', borderColor: 'rgba(255,255,255,0.35)' }}
      />
      <View
        className="absolute border-b-2"
        style={{ top: '50%', left: 0, right: 0, borderColor: 'rgba(255,255,255,0.35)' }}
      />
      {placed.map(({ player, x, y }) => (
        <PitchPlayer key={player.playerId} player={player} x={x} y={y} color={detail.teamColor} />
      ))}
    </View>
  );
}

function PitchPlayer({
  player,
  x,
  y,
  color,
}: {
  player: DetailFieldPlayer;
  x: number;
  y: number;
  color: string;
}) {
  return (
    <View
      className="absolute items-center"
      style={{ left: `${x}%`, top: `${y}%`, width: 56, transform: [{ translateX: -28 }, { translateY: -22 }] }}
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-full border-2 border-white"
        style={{ backgroundColor: color || '#0F1B2E' }}
      >
        <Text className="text-xs font-bold text-white">
          {player.dorsal ?? player.label.slice(0, 2)}
        </Text>
      </View>
      <Text className="mt-0.5 text-[10px] text-white" numberOfLines={1}>
        {player.label}
      </Text>
    </View>
  );
}

function StatsCard({ detail }: { detail: MatchDetail }) {
  const ts = detail.teamStats;
  const rows: { key: string; own: number; rival: number }[] = [
    { key: 'goals', own: detail.goalsOwn, rival: detail.goalsRival },
    { key: 'shots', own: ts.shots.own, rival: ts.shots.rival },
    { key: 'corners', own: ts.corners.own, rival: ts.corners.rival },
    { key: 'fouls', own: ts.fouls.own, rival: ts.fouls.rival },
    { key: 'yellow', own: ts.yellowCards.own, rival: ts.yellowCards.rival },
    { key: 'red', own: ts.redCards.own, rival: ts.redCards.rival },
    { key: 'offsides', own: ts.offsides.own, rival: ts.offsides.rival },
  ];
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {t('directo.stats')}
      </Text>
      {rows.map((r) => (
        <View key={r.key} className="flex-row items-center border-b border-zinc-100 py-1.5">
          <Text className="w-10 text-left text-sm font-semibold text-[#0F1B2E] tabular-nums">{r.own}</Text>
          <Text className="flex-1 text-center text-xs text-zinc-500">{t(`directo.stat.${r.key}`)}</Text>
          <Text className="w-10 text-right text-sm font-semibold text-[#0F1B2E] tabular-nums">{r.rival}</Text>
        </View>
      ))}
    </View>
  );
}

function EventsCard({ detail }: { detail: MatchDetail }) {
  const listed = detail.events.filter((e) => LISTED_EVENTS.has(e.type));
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {t('directo.events')}
      </Text>
      {listed.length === 0 ? (
        <Text className="py-4 text-center text-sm text-zinc-400">{t('directo.no_events')}</Text>
      ) : (
        listed.map((e) => {
          const min = e.displayMinute ?? Math.floor(e.clockSeconds / 60);
          return (
            <View key={e.id} className="flex-row items-center gap-3 border-b border-zinc-100 py-2">
              <Text className="w-8 text-right text-sm text-zinc-400 tabular-nums">{`${min}'`}</Text>
              <Text className="text-sm font-medium text-[#0F1B2E]">{t(`directo.event.${e.type}`)}</Text>
              <Text className="flex-1 text-sm text-zinc-500" numberOfLines={1}>
                {e.side === 'rival' ? `${t('directo.event.rival')} ${e.label}` : e.label}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}
