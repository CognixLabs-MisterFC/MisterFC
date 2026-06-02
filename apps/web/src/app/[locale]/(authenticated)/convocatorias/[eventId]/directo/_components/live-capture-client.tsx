'use client';

/**
 * F7.2/7.3 — Pantalla de toma de datos en directo (HORIZONTAL, tablet/portátil
 * táctil tipo Chromebook): cronómetro completo (7.7), campo, paleta de símbolos
 * e interruptor equipo/rival.
 *
 * Monta <MatchFieldEditor mode='live-overlay'> (NO lo reescribe). F7.3 cablea
 * onPlayerClick DE VERDAD: con un símbolo de jugador seleccionado (gol,
 * asistencia, amarilla, roja), tocar un jugador del campo registra una fila en
 * match_events (side='own') con clock_seconds/period/display_minute derivados
 * del reloj de 7.7. Registro OPTIMISTA + lista de "últimos eventos". Editar/
 * borrar es la línea de tiempo (7.9); los eventos de campo, 7.4; cambios, 7.5.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  ClipboardList,
  Flag,
  Footprints,
  Goal,
  Square,
  Target,
} from 'lucide-react';
import {
  clockSecondsAt,
  currentPeriod,
  displayMinute as toDisplayMinute,
  isPlayerEventType,
  type ClockPeriod,
  type TeamFormat,
} from '@misterfc/core';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { LiveFieldPlayer, LiveMatchEvent } from '../queries';
import { registerPlayerEvent } from '../actions';
import { MatchClock, MatchClockOverlay } from './match-clock';

type MatchSide = 'own' | 'rival';

// Tipos de evento de la paleta (coinciden con match_events.type de F7.1). El
// DRAG real de estos símbolos llega en 7.3/7.4; aquí son botones seleccionables.
const EVENT_TYPES = [
  'goal',
  'assist',
  'yellow_card',
  'red_card',
  'substitution',
  'corner',
  'foul',
  'offside',
  'shot',
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_ICON: Record<EventType, typeof Goal> = {
  goal: Goal,
  assist: Footprints,
  yellow_card: Square,
  red_card: Square,
  substitution: ArrowLeftRight,
  corner: Flag,
  foul: AlertTriangle,
  offside: Ban,
  shot: Target,
};

// Color del icono para las tarjetas (resto hereda el color del botón).
const EVENT_ICON_CLASS: Partial<Record<EventType, string>> = {
  yellow_card: 'fill-amber-400 text-amber-500',
  red_card: 'fill-red-500 text-red-600',
};

type Props = {
  eventId: string;
  eventType: 'match' | 'friendly';
  opponentName: string | null;
  format: TeamFormat;
  formationCode: string;
  fieldPlayers: LiveFieldPlayer[];
  hasOfficialLineup: boolean;
  matchStatus: 'not_started' | 'live' | 'closed';
  periods: ClockPeriod[];
  halfDurationMinutes: number;
  recentEvents: LiveMatchEvent[];
};

export function LiveCaptureClient({
  eventId,
  eventType,
  opponentName,
  format,
  formationCode,
  fieldPlayers,
  hasOfficialLineup,
  matchStatus,
  periods,
  halfDurationMinutes,
  recentEvents,
}: Props) {
  const t = useTranslations('partido_directo');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [side, setSide] = useState<MatchSide>('own');
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  // Eventos registrados en este cliente aún no reflejados por el servidor
  // (registro optimista). Se deduplican por id contra `recentEvents`.
  const [optimistic, setOptimistic] = useState<LiveMatchEvent[]>([]);

  // Sin alineación oficial no hay once que pintar (no auto-marcamos ninguna ni
  // hacemos fallback a "la última"): empty-state claro con CTA al editor.
  if (!hasOfficialLineup) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/30 px-6 py-16 text-center">
        <ClipboardList className="size-10 text-muted-foreground" aria-hidden />
        <div className="flex max-w-md flex-col gap-1">
          <p className="text-lg font-semibold">{t('empty_title')}</p>
          <p className="text-sm text-muted-foreground">{t('empty_desc')}</p>
        </div>
        <Button asChild>
          <Link href={`/convocatorias/${eventId}/alineacion`}>
            <ClipboardList className="size-4" aria-hidden />
            <span>{t('empty_cta')}</span>
          </Link>
        </Button>
      </div>
    );
  }

  const players: FieldEditorPlayer[] = fieldPlayers.map((p) => ({
    playerId: p.playerId,
    label: p.label,
    dorsal: p.dorsal,
    photoUrl: p.photoUrl,
    positionCode: p.positionCode,
    xPct: p.xPct,
    yPct: p.yPct,
  }));

  // Lista mostrada: optimistas aún no confirmados por el servidor + los del
  // servidor (dedupe por id). Más recientes primero (clock_seconds desc).
  const events: LiveMatchEvent[] = [
    ...optimistic.filter((o) => !recentEvents.some((r) => r.id === o.id)),
    ...recentEvents,
  ];

  // F7.3 — registrar un evento sobre un jugador propio. side/clock/period los
  // resuelve el servidor; aquí pintamos optimista y confirmamos con refresh.
  function handlePlayerClick(playerId: string) {
    if (matchStatus !== 'live') {
      toast.warning(t('register_not_live'));
      return;
    }
    if (!selectedEvent) {
      toast.info(t('register_select_event'));
      return;
    }
    if (!isPlayerEventType(selectedEvent)) {
      toast.info(t('register_not_player_event'));
      return;
    }

    const type = selectedEvent;
    const p = fieldPlayers.find((x) => x.playerId === playerId);
    const label = p?.label ?? playerId.slice(0, 4);

    // id de cliente → reintento idempotente (§10). Reloj optimista con el motor
    // de 7.7; el servidor recalcula el autoritativo al insertar.
    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, Date.now());
    const cur = currentPeriod(periods);
    const optimisticRow: LiveMatchEvent = {
      id,
      type,
      playerId,
      playerLabel: label,
      dorsal: p?.dorsal ?? null,
      clockSeconds,
      displayMinute: toDisplayMinute(clockSeconds),
      period: cur?.period ?? 'first_half',
    };
    setOptimistic((prev) => [optimisticRow, ...prev]);
    setSelectedEvent(null); // evita doble registro accidental en el siguiente toque

    startTransition(async () => {
      const res = await registerPlayerEvent({
        event_id: eventId,
        id,
        type,
        player_id: playerId,
      });
      if (res.error) {
        setOptimistic((prev) => prev.filter((e) => e.id !== id));
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      toast.success(
        t('event_registered', {
          event: t(`event.${type}`),
          player: label,
          minute: toDisplayMinute(clockSeconds),
        }),
      );
      router.refresh();
    });
  }

  function handleFieldClick(xPct: number, yPct: number) {
    toast.info(
      t('stub_field', {
        event: selectedEvent ? t(`event.${selectedEvent}`) : t('no_event'),
        x: Math.round(xPct),
        y: Math.round(yPct),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Barra superior: cronómetro completo (F7.7) y toggle equipo/rival. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 p-3">
        <MatchClock
          eventId={eventId}
          status={matchStatus}
          periods={periods}
          halfDurationMinutes={halfDurationMinutes}
        />

        {/* Interruptor equipo / rival (segmented). */}
        <div
          role="group"
          aria-label={t('side_label')}
          className="inline-flex rounded-md border border-border p-0.5"
        >
          <button
            type="button"
            onClick={() => setSide('own')}
            aria-pressed={side === 'own'}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              side === 'own'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t('side_own')}
          </button>
          <button
            type="button"
            onClick={() => setSide('rival')}
            aria-pressed={side === 'rival'}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              side === 'rival'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t('side_rival')}
            {opponentName ? ` · ${opponentName}` : ''}
          </button>
        </div>
      </div>

      {/* Cuerpo: paleta | campo | panel lateral. En táctil horizontal las tres
          columnas conviven; en pantallas estrechas se apilan. */}
      <div className="flex flex-col gap-3 lg:flex-row">
        {/* Paleta de símbolos de eventos. */}
        <div className="rounded-lg border border-border bg-card/40 p-3 lg:w-44 lg:shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('palette_title')}
          </p>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
            {EVENT_TYPES.map((ev) => {
              const Icon = EVENT_ICON[ev];
              const active = selectedEvent === ev;
              return (
                <button
                  key={ev}
                  type="button"
                  onClick={() => setSelectedEvent(active ? null : ev)}
                  aria-pressed={active}
                  className={cn(
                    'flex touch-none flex-col items-center gap-1 rounded-md border p-2 text-[11px] font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon
                    className={cn('size-5', EVENT_ICON_CLASS[ev])}
                    aria-hidden
                  />
                  <span className="text-center leading-tight">
                    {t(`event.${ev}`)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-tight text-muted-foreground">
            {t('palette_hint')}
          </p>
        </div>

        {/* Campo con el once oficial. live-overlay: clic en jugador/césped +
            overlay del cronómetro como children. */}
        <div className="flex min-w-0 flex-1 items-start justify-center rounded-lg border border-border bg-card/20 p-3">
          <MatchFieldEditor
            format={format}
            formationCode={formationCode}
            players={players}
            mode="live-overlay"
            onPlayerClick={handlePlayerClick}
            onFieldClick={handleFieldClick}
            // Horizontal: el límite es la altura → dimensionamos por alto
            // (w-auto/max-w-none neutralizan w-full/max-w-md del componente; el
            // aspect-[2/3] base deriva la anchura).
            className="h-[68vh] max-h-[68vh] w-auto max-w-none"
          >
            {/* Mini-reloj de solo lectura sobre el campo (slot children). */}
            <MatchClockOverlay periods={periods} />
          </MatchFieldEditor>
        </div>

        {/* Panel lateral: bando rival (7.6) o lista de eventos propios (7.3). */}
        <div className="rounded-lg border border-border bg-card/40 p-3 lg:w-56 lg:shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {side === 'own' ? t('recent_events_title') : t('panel_rival_title')}
          </p>
          {side === 'rival' ? (
            <p className="text-sm text-muted-foreground">
              {t('panel_rival_hint')}
            </p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('no_events_yet')}</p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
              {events.map((ev) => {
                const Icon = EVENT_ICON[ev.type];
                return (
                  <li
                    key={ev.id}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-sm"
                  >
                    <span className="w-7 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {ev.displayMinute ?? Math.floor(ev.clockSeconds / 60)}&#39;
                    </span>
                    <Icon
                      className={cn('size-4 shrink-0', EVENT_ICON_CLASS[ev.type])}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {ev.dorsal != null ? `${ev.dorsal} · ` : ''}
                      {ev.playerLabel}
                    </span>
                    <span className="sr-only">{t(`event.${ev.type}`)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground lg:hidden">
        {t('landscape_hint')}
      </p>
      <p className="text-center text-[11px] text-muted-foreground">
        {eventType === 'friendly' ? t('friendly_note') : t('scope_note')}
      </p>
    </div>
  );
}
