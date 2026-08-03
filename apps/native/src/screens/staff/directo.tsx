import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  adjustClockFromClient,
  canFinishMatch,
  currentPeriod,
  endPeriodFromClient,
  eventScopedCacheKey,
  finishMatchFromClient,
  getMatchDetailFromClient,
  isAtBreak,
  isClockRunning,
  matchPhase,
  nextPeriodAfter,
  pauseClockFromClient,
  reopenMatchFromClient,
  resumeClockFromClient,
  startMatchFromClient,
  startNextPeriodFromClient,
  userCanRecordMatchFromClient,
  type ClockPeriod,
  type ClockWriteError,
  type MatchDetail,
  type MatchPhaseKind,
  type PeriodKind,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/**
 * O2-9a — CONTROL del directo (staff): el RELOJ y el ESTADO del partido. Lee el estado
 * (core `getMatchDetailFromClient`, read-only, compartido con B2) y ofrece los controles
 * de reloj/estado: iniciar, pausar/reanudar, terminar parte, empezar siguiente periodo,
 * ajuste manual, finalizar y reabrir. El reloj es ESCRITURA RLS DIRECTA y ONLINE (no
 * encolable: son filas autoritativas de match_state/match_periods) → WRITE-GUARD: sin red
 * los controles van deshabilitados con aviso; NADA de cola (la cola es solo eventos, 9b).
 * GATE server-side (`user_can_record_match`): sin permiso, controles deshabilitados; un
 * rechazo llega como forbidden. El reloj TICKEA local (matchPhase, como B2), sin polling
 * del cronómetro. Caché event-scoped (`directo-estado::${eventId}`), lectura offline del
 * último estado. La ENTRADA de eventos y el timeline en vivo son 9b (hueco abajo).
 */

const LIVE_POLL_MS = 15_000;
const LIVE_PHASES: ReadonlySet<MatchPhaseKind> = new Set([
  'first_half',
  'second_half',
  'extra_time',
]);

type ControlData = { detail: MatchDetail; canRecord: boolean };

/** "Ahora" que tickea cada segundo con el partido en vivo (patrón B1/B2, sin setState-en-effect del reloj). */
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

function errorKeyFor(e: ClockWriteError): string {
  switch (e) {
    case 'forbidden':
      return 'directo_control.err_forbidden';
    case 'no_official_lineup':
      return 'directo_control.err_no_lineup';
    case 'regulation_incomplete':
      return 'directo_control.err_regulation';
    case 'already_closed':
      return 'directo_control.err_closed';
    case 'not_live':
      return 'directo_control.err_not_live';
    default:
      return 'directo_control.err_generic';
  }
}

export function DirectoControlScreen({ eventId }: { eventId: string | null }) {
  const { activeClub, theme } = useApp();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<ControlData | null>(
    eventScopedCacheKey('directo-estado', eventId ?? 'none'),
    async (sb) => {
      if (!eventId || !clubId) return null;
      const detail = await getMatchDetailFromClient(sb, clubId, eventId);
      if (!detail) return null;
      const canRecord = await userCanRecordMatchFromClient(sb, eventId);
      return { detail, canRecord };
    },
  );

  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const detail = data?.detail ?? null;
  const canRecord = !!data?.canRecord;
  const status = detail?.status ?? 'not_started';
  const isLive = status === 'live';
  const now = useTickingNow(isLive);

  // Poll en vivo (como B2): refleja cambios de estado/eventos de otro dispositivo o de
  // la web. El cronómetro NO depende del poll (tickea local); esto solo re-lee el estado.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [isLive, refresh]);

  // WRITE-GUARD + GATE (cliente): controlar el reloj exige permiso, red y no estar ocupado.
  const editable = canRecord && online && !busy;

  const run = useCallback(
    async (
      fn: (sb: typeof supabase, input: unknown) => Promise<{ ok: true } | { ok: false; error: ClockWriteError }>,
      input: unknown,
    ) => {
      if (!eventId || !editable) return;
      setBusy(true);
      setErrorKey(null);
      const r = await fn(supabase, input);
      setBusy(false);
      if (!r.ok) setErrorKey(errorKeyFor(r.error));
      else refresh(); // refleja lo GUARDADO
    },
    [eventId, editable, refresh],
  );

  if (!eventId) return <EmptyState message={t('directo_control.pick_match')} />;
  if (loading) return <LoadingScreen />;
  if (!detail) return <EmptyState message={t('directo_control.unavailable')} />;

  const periods = detail.periods;
  const cur = currentPeriod(periods);
  const running = isClockRunning(periods);
  const atBreak = isAtBreak(periods);
  const next = nextPeriodAfter(periods);
  const canFinish = canFinishMatch(periods);
  const ref = { event_id: eventId };

  // Reloj/fase (matchPhase, tick local en vivo).
  const { phase, minute, addedTime } = matchPhase({
    status: detail.status,
    periods,
    halfDurationMinutes: detail.halfDurationMinutes,
    nowMs: isLive ? now : frozenNow(periods),
  });
  const minuteText =
    isLive && LIVE_PHASES.has(phase)
      ? addedTime > 0
        ? t('directo.minute_added', { minute: String(minute), added: String(addedTime) })
        : t('directo.minute', { minute: String(minute) })
      : t(`directo.phase.${phase}`);

  const periodLabel = (p: PeriodKind) => t(`directo_control.period.${p}`);

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('directo_control.title')}</ScreenTitle>

        {/* Marcador + reloj (derivado; el reloj tickea local). */}
        <View
          className="rounded-2xl border border-zinc-200 p-4"
          style={{ borderLeftWidth: 4, borderLeftColor: accent }}
        >
          <View className="flex-row items-center justify-center gap-2">
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: detail.teamColor || accent }} />
            <Text className="text-xs text-zinc-400" numberOfLines={1}>
              {detail.teamName} · {detail.categoryName}
            </Text>
          </View>
          <View className="mt-1 flex-row items-center justify-center gap-3">
            <Text className="text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
              {detail.teamName}
            </Text>
            <Text className="text-3xl font-extrabold text-[#0F1B2E] tabular-nums">
              {detail.goalsOwn} - {detail.goalsRival}
            </Text>
            <Text className="text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
              {detail.opponentName ?? ''}
            </Text>
          </View>
          <View className="mt-2 flex-row items-center justify-center gap-2">
            {isLive ? (
              <View className={`rounded-full px-2 py-0.5 ${running ? 'bg-red-500' : 'bg-amber-500'}`}>
                <Text className="text-[10px] font-bold text-white">
                  {running ? t('directo.live') : t('directo_control.paused')}
                </Text>
              </View>
            ) : null}
            <Text className="text-base text-zinc-600 tabular-nums">{minuteText}</Text>
          </View>
        </View>

        {/* Aviso de gate / write-guard. */}
        {!canRecord ? (
          <Banner text={t('directo_control.no_permission')} />
        ) : !online ? (
          <Banner text={t('directo_control.offline_write')} />
        ) : null}
        {errorKey ? (
          <View className="rounded-xl bg-red-50 px-4 py-2">
            <Text className="text-center text-xs text-red-600">{t(errorKey)}</Text>
          </View>
        ) : null}

        {/* CONTROLES de reloj/estado según la fase. */}
        <View className="rounded-2xl border border-zinc-200 p-4" style={{ gap: 10 }}>
          <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('directo_control.clock')}
          </Text>

          {status === 'not_started' ? (
            <Btn
              label={t('directo_control.start_match')}
              accent={accent}
              disabled={!editable}
              onPress={() => run(startMatchFromClient, ref)}
              primary
            />
          ) : null}

          {status === 'live' ? (
            <>
              {atBreak && next ? (
                <Btn
                  label={t('directo_control.start_next', { period: periodLabel(next.period) })}
                  accent={accent}
                  disabled={!editable}
                  onPress={() => run(startNextPeriodFromClient, { event_id: eventId, period: next.period })}
                  primary
                />
              ) : running ? (
                <Btn
                  label={t('directo_control.pause')}
                  accent={accent}
                  disabled={!editable}
                  onPress={() => run(pauseClockFromClient, ref)}
                />
              ) : cur && !cur.ended ? (
                <Btn
                  label={t('directo_control.resume')}
                  accent={accent}
                  disabled={!editable}
                  onPress={() => run(resumeClockFromClient, ref)}
                  primary
                />
              ) : null}

              {cur && !cur.ended ? (
                <>
                  <Btn
                    label={t('directo_control.end_period')}
                    accent={accent}
                    disabled={!editable}
                    onPress={() => run(endPeriodFromClient, ref)}
                  />
                  <View className="flex-row items-center justify-center gap-2">
                    <Text className="text-xs text-zinc-400">{t('directo_control.adjust')}</Text>
                    {[-60, -10, 10, 60].map((d) => (
                      <Pressable
                        key={d}
                        disabled={!editable}
                        onPress={() => run(adjustClockFromClient, { event_id: eventId, delta_seconds: d })}
                        className="rounded-lg border border-zinc-200 px-2.5 py-1.5 active:opacity-70"
                        style={{ opacity: editable ? 1 : 0.4 }}
                      >
                        <Text className="text-xs text-zinc-600 tabular-nums">
                          {d > 0 ? `+${d}` : `${d}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {canFinish ? (
                <Btn
                  label={t('directo_control.finish')}
                  accent={accent}
                  disabled={!editable}
                  onPress={() => run(finishMatchFromClient, ref)}
                  danger
                />
              ) : null}
            </>
          ) : null}

          {status === 'closed' ? (
            <ConfirmBtn
              label={t('directo_control.reopen')}
              confirmLabel={t('directo_control.reopen_confirm')}
              disabled={!editable}
              onConfirm={() => run(reopenMatchFromClient, ref)}
            />
          ) : null}
        </View>

        {/* HUECO 9b — aquí engancharán la ENTRADA RÁPIDA de eventos (con cola offline) y
            el TIMELINE en vivo editable. En 9a el partido se controla (reloj/estado); el
            registro de goles/tarjetas/cambios llega en 9b. */}
        <View className="rounded-2xl border border-dashed border-zinc-300 p-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('directo_control.events')}
          </Text>
          <Text className="mt-1 text-sm text-zinc-400">{t('directo_control.events_soon')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View className="rounded-xl bg-zinc-100 px-4 py-2">
      <Text className="text-center text-xs text-zinc-500">{text}</Text>
    </View>
  );
}

function Btn({
  label,
  accent,
  disabled,
  onPress,
  primary,
  danger,
}: {
  label: string;
  accent: string;
  disabled: boolean;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const bg = danger ? '#dc2626' : primary ? accent : undefined;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className="rounded-xl px-4 py-3 active:opacity-70"
      style={{
        backgroundColor: bg,
        borderWidth: bg ? 0 : 1,
        borderColor: '#e4e4e7',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        className={`text-center text-sm font-semibold ${bg ? 'text-white' : 'text-[#0F1B2E]'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Botón destructivo en dos pasos (finalizar/reabrir), como la web. */
function ConfirmBtn({
  label,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
      className="rounded-xl px-4 py-3 active:opacity-70"
      style={{
        borderWidth: 1,
        borderColor: armed ? '#dc2626' : '#e4e4e7',
        backgroundColor: armed ? 'rgba(220,38,38,0.08)' : undefined,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text className={`text-center text-sm font-semibold ${armed ? 'text-red-600' : 'text-[#0F1B2E]'}`}>
        {armed ? confirmLabel : label}
      </Text>
    </Pressable>
  );
}
