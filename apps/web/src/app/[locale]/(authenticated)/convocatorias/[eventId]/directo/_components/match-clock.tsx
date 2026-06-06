'use client';

/**
 * F7.7 — Cronómetro del partido en vivo.
 *
 * Spec 7.0 §3.2/§3.3/§6. Se RECONSTRUYE desde `periods` (match_periods) en cada
 * render → sobrevive a recargas: el tiempo no vive en memoria, solo el "tick"
 * que repinta cada segundo mientras corre. Toda la aritmética la hace el motor
 * puro de @misterfc/core (clockSecondsAt, currentPeriod, …); aquí solo pintamos
 * y orquestamos las server actions.
 *
 * Estados: sin empezar (Iniciar partido) · jugando (Pausar · Fin de parte ·
 * Ajuste ±) · pausa (Reanudar) · descanso (Iniciar siguiente periodo) · fin del
 * tiempo (sin más periodos; el CIERRE del partido es 7.10).
 */

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Flag,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Square,
  Timer,
} from 'lucide-react';
import {
  type ClockPeriod,
  type PeriodKind,
  clockSecondsAt,
  currentPeriod,
  displayMinute,
  formatClock,
  isAtBreak,
  isClockRunning,
  nextExtraPeriod,
  nextRegularPeriod,
  periodClockSeconds,
} from '@misterfc/core';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  adjustClock,
  endPeriod,
  finishMatch,
  pauseClock,
  reopenMatch,
  resumeClock,
  startMatch,
  startNextPeriod,
  type ClockActionState,
} from '../actions';

type Props = {
  eventId: string;
  status: 'not_started' | 'live' | 'closed';
  periods: ClockPeriod[];
  /** Duración SUGERIDA de cada tiempo (min), de la categoría del equipo. */
  halfDurationMinutes: number;
  /** F7.7c — abrir la tanda de penaltis (desempate) desde el flujo de fin. */
  onOpenShootout?: () => void;
  /** F7.7c — ¿la tanda ya está abierta? (oculta el botón de entrada). */
  shootoutOpen?: boolean;
};

// Tiempos a los que aplica la duración sugerida de la categoría. La prórroga y
// los penaltis no tienen duración "de categoría" definida → solo se cuentan.
const HALF_PERIODS: ReadonlyArray<PeriodKind> = ['first_half', 'second_half'];

// Botones de ajuste manual (segundos). Táctil: pocos y grandes.
const ADJUST_STEPS = [-60, -10, 10, 60] as const;

/**
 * "Ahora" en ms como external store (React-recomendado para valores solo del
 * cliente: evita setState-en-effect y el desajuste de hidratación). En el
 * servidor → null (el caller cae a `frozenNow`). Al suscribir se notifica de
 * inmediato → tiempo correcto desde el primer paint del cliente, sin saltos al
 * recargar a mitad de parte. Solo tictaquea (1s) si `active`.
 */
function useTickingNow(active: boolean): number | null {
  const nowRef = useRef<number | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      nowRef.current = Date.now();
      onChange();
      if (!active) return () => {};
      const id = setInterval(() => {
        nowRef.current = Date.now();
        onChange();
      }, 1000);
      return () => clearInterval(id);
    },
    [active],
  );
  return useSyncExternalStore(
    subscribe,
    () => nowRef.current,
    () => null,
  );
}

export function MatchClock({
  eventId,
  status,
  periods,
  halfDurationMinutes,
  onOpenShootout,
  shootoutOpen,
}: Props) {
  const t = useTranslations('partido_directo');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const running = isClockRunning(periods);
  const now = useTickingNow(running);
  // F7.7b — confirmación de "Finalizar partido" (acción significativa). Dos
  // pasos en línea, sin diálogo modal. F7.10 — ídem para "Reabrir partido".
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);

  // Evita refrescos en cascada si llegan varias acciones seguidas.
  const refreshing = useRef(false);
  function run(action: () => Promise<ClockActionState>) {
    startTransition(async () => {
      const res = await action();
      if (res.error) {
        toast.error(t(`clock_error.${res.error}`));
        return;
      }
      if (!refreshing.current) {
        refreshing.current = true;
        router.refresh();
        // Tras un refresh, `periods` llega por props; soltamos el cerrojo.
        setTimeout(() => {
          refreshing.current = false;
        }, 50);
      }
    });
  }

  const cur = currentPeriod(periods);
  const atBreak = isAtBreak(periods);
  // F7.7b — flujo por defecto 1ª → 2ª → finalizar; la prórroga es OPCIONAL.
  // `regularNext` = la 2ª parte tras la 1ª (null tras la 2ª); `extraNext` = la
  // prórroga que se podría AÑADIR (null si no procede).
  const regularNext = nextRegularPeriod(periods);
  const extraNext = nextExtraPeriod(periods);
  const hasStarted = periods.length > 0 && status !== 'not_started';
  // En un periodo (corriendo o en pausa, sin terminar) vs en una pausa de
  // decisión (periodo terminado y reloj parado).
  const inPeriod = hasStarted && status === 'live' && cur != null && !cur.ended;
  const atDecision =
    hasStarted && status === 'live' && cur != null && cur.ended && !running;
  // Servidor / primer paint: reloj plegado (frozenNow) → hidratación estable.
  // Cliente: tiempo real del tick.
  const effectiveNow = now ?? frozenNow(periods);
  const seconds = clockSecondsAt(periods, effectiveNow);

  // Progreso de la PARTE actual vs su duración sugerida por la CATEGORÍA
  // (§3.2/§6): tiempo dentro del periodo = reloj del periodo − su base_offset.
  // No se impone: si supera lo sugerido, se marca como prolongación, no se corta.
  const suggestedHalfSeconds = halfDurationMinutes * 60;
  const showHalfProgress =
    hasStarted &&
    status !== 'closed' &&
    !atBreak &&
    cur != null &&
    !cur.ended &&
    HALF_PERIODS.includes(cur.period);
  const periodElapsed = cur ? periodClockSeconds(cur, effectiveNow) - cur.baseOffsetSeconds : 0;
  const overSuggested = showHalfProgress && periodElapsed > suggestedHalfSeconds;

  const periodLabel = (p: PeriodKind) => t(`period.${p}`);

  // Etiqueta de estado bajo el reloj.
  let phaseLabel: string;
  let phaseTone: 'idle' | 'live' | 'break' | 'done' = 'idle';
  if (status === 'closed') {
    phaseLabel = t('status_closed');
    phaseTone = 'done';
  } else if (!hasStarted) {
    phaseLabel = t('status_not_started');
    phaseTone = 'idle';
  } else if (atDecision && regularNext) {
    // Pausa entre la 1ª y la 2ª parte → descanso.
    phaseLabel = t('clock_break');
    phaseTone = 'break';
  } else if (atDecision) {
    // Tiempo reglamentario (o prórroga) cumplido: finalizar o añadir prórroga.
    phaseLabel = t('clock_regulation_over');
    phaseTone = 'done';
  } else if (inPeriod && cur) {
    phaseLabel = running
      ? periodLabel(cur.period)
      : t('clock_paused_in', { period: periodLabel(cur.period) });
    phaseTone = 'live';
  } else {
    phaseLabel = t('status_not_started');
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Display del reloj. */}
      <div className="flex items-center gap-2">
        <Timer className="size-5 text-muted-foreground" aria-hidden />
        <span
          className="font-mono text-3xl font-semibold tabular-nums"
          aria-label={t('clock_label')}
          suppressHydrationWarning
        >
          {formatClock(seconds)}
        </span>
        <Badge
          variant={phaseTone === 'live' && running ? 'default' : 'secondary'}
          className={cn(
            phaseTone === 'break' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
            phaseTone === 'done' && 'bg-muted text-muted-foreground',
          )}
        >
          {phaseLabel}
        </Badge>
        {hasStarted && status !== 'closed' && (
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            {t('clock_minute', { minute: displayMinute(seconds) })}
          </span>
        )}
      </div>

      {/* Progreso de la parte vs duración sugerida por la categoría (§3.2/§6).
          Solo referencia: el operador puede prolongar. Demuestra que el reloj
          lee half_duration_minutes (Alevín 30, juvenil 45…), no un valor fijo. */}
      {showHalfProgress && (
        <span
          className={cn(
            'text-xs tabular-nums',
            overSuggested ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
          )}
          suppressHydrationWarning
        >
          {overSuggested
            ? t('clock_half_overtime', {
                elapsed: formatClock(periodElapsed),
                target: formatClock(suggestedHalfSeconds),
              })
            : t('clock_half_progress', {
                elapsed: formatClock(periodElapsed),
                target: formatClock(suggestedHalfSeconds),
              })}
        </span>
      )}

      {/* Controles según el estado (F7.7b: 2 partes → finalizar; prórroga opcional). */}
      <div className="flex flex-wrap items-center gap-2">
        {status === 'closed' ? (
          // F7.10 — partido cerrado: aviso de consolidación + reabrir (2 pasos).
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {t('stats_consolidated')}
            </span>
            {confirmReopen ? (
              <>
                <span className="text-sm">{t('clock_reopen_confirm')}</span>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => reopenMatch({ event_id: eventId }))}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  <span>{t('clock_reopen_yes')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setConfirmReopen(false)}
                >
                  <span>{t('clock_reopen_cancel')}</span>
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirmReopen(true)}
              >
                <RotateCcw className="size-4" aria-hidden />
                <span>{t('clock_reopen')}</span>
              </Button>
            )}
          </>
        ) : !hasStarted ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => startMatch({ event_id: eventId }))}>
            <Play className="size-4" aria-hidden />
            <span>{t('clock_start_match')}</span>
          </Button>
        ) : atDecision && regularNext ? (
          // Descanso: arrancar la 2ª parte (acción principal del flujo regular).
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => startNextPeriod({ event_id: eventId, period: regularNext.period }))
            }
          >
            <Play className="size-4" aria-hidden />
            <span>{t('clock_start_period', { period: periodLabel(regularNext.period) })}</span>
          </Button>
        ) : atDecision ? (
          // Tiempo reglamentario (o prórroga) cumplido: FINALIZAR (principal) y,
          // opcionalmente, AÑADIR PRÓRROGA (secundario). Nunca se fuerza la prórroga.
          confirmFinish ? (
            <>
              <span className="text-sm">{t('clock_finish_confirm')}</span>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(() => finishMatch({ event_id: eventId }))}
              >
                <Square className="size-4" aria-hidden />
                <span>{t('clock_finish_yes')}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirmFinish(false)}
              >
                <span>{t('clock_finish_cancel')}</span>
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={pending} onClick={() => setConfirmFinish(true)}>
                <Square className="size-4" aria-hidden />
                <span>{t('clock_finish_match')}</span>
              </Button>
              {extraNext && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(() => startNextPeriod({ event_id: eventId, period: extraNext.period }))
                  }
                >
                  <Plus className="size-4" aria-hidden />
                  <span>
                    {extraNext.period === 'extra_first'
                      ? t('clock_add_extra')
                      : t('clock_start_period', { period: periodLabel(extraNext.period) })}
                  </span>
                </Button>
              )}
              {/* F7.7c — tanda de penaltis: SOLO tras la prórroga (sin más extra). */}
              {!extraNext && onOpenShootout && !shootoutOpen && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={onOpenShootout}
                >
                  <Flag className="size-4" aria-hidden />
                  <span>{t('clock_shootout')}</span>
                </Button>
              )}
            </>
          )
        ) : inPeriod ? (
          <>
            {running ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => pauseClock({ event_id: eventId }))}
              >
                <Pause className="size-4" aria-hidden />
                <span>{t('clock_pause')}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(() => resumeClock({ event_id: eventId }))}
              >
                <Play className="size-4" aria-hidden />
                <span>{t('clock_resume')}</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => endPeriod({ event_id: eventId }))}
            >
              {regularNext ? (
                <SkipForward className="size-4" aria-hidden />
              ) : (
                <Square className="size-4" aria-hidden />
              )}
              <span>{t('clock_end_period')}</span>
            </Button>

            {/* Ajuste manual (§6). */}
            <div
              role="group"
              aria-label={t('clock_adjust_label')}
              className="inline-flex items-center gap-1 rounded-md border border-border p-0.5"
            >
              {ADJUST_STEPS.map((delta) => (
                <Button
                  key={delta}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  className="h-7 gap-0.5 px-1.5 text-xs"
                  aria-label={t('clock_adjust_by', { seconds: delta })}
                  onClick={() => run(() => adjustClock({ event_id: eventId, delta_seconds: delta }))}
                >
                  {delta < 0 ? (
                    <Minus className="size-3" aria-hidden />
                  ) : (
                    <Plus className="size-3" aria-hidden />
                  )}
                  {formatStep(delta)}
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Mini-reloj de SOLO LECTURA para superponer sobre el campo (slot `children` de
 * live-overlay). Mismo motor; sin controles. Útil al registrar eventos mirando
 * el césped sin desviar la vista a la barra superior.
 */
export function MatchClockOverlay({ periods }: { periods: ClockPeriod[] }) {
  const now = useTickingNow(isClockRunning(periods));
  if (periods.length === 0) return null;
  const seconds = clockSecondsAt(periods, now ?? frozenNow(periods));
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-0.5 font-mono text-sm font-semibold tabular-nums text-white"
      suppressHydrationWarning
    >
      {formatClock(seconds)}
    </div>
  );
}

/** Para el render del servidor / pre-montaje: reloj sin la parte "corriendo". */
function frozenNow(periods: ClockPeriod[]): number {
  // Usamos lastStartedAt del periodo en curso como `now` → elapsed corrido = 0,
  // así el primer paint (server) muestra el reloj plegado sin saltos de hidratación.
  const cur = currentPeriod(periods);
  if (cur?.running && cur.lastStartedAt) return Date.parse(cur.lastStartedAt);
  return 0;
}

/** "1:00" / "0:10" para el botón de ajuste (valor absoluto). */
function formatStep(deltaSeconds: number): string {
  const abs = Math.abs(deltaSeconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
