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
  RotateCcw,
  Square,
  Target,
  UserMinus,
  X,
} from 'lucide-react';
import {
  clockSecondsAt,
  currentPeriod,
  deriveExpelledPlayers,
  deriveSquad,
  displayMinute as toDisplayMinute,
  isExpelled,
  isFieldEventType,
  isPlayerEventType,
  mergeLiveEvents,
  resolveCardOutcome,
  type ClockPeriod,
  type Sub,
  type TeamFormat,
} from '@misterfc/core';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type {
  LiveBenchPlayer,
  LiveFieldPlayer,
  LiveMatchEvent,
  LiveSubstitution,
} from '../queries';
import {
  registerFieldEvent,
  registerPlayerEvent,
  registerSubstitution,
  setPlayerAbsent,
} from '../actions';
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
  benchPlayers: LiveBenchPlayer[];
  substitutions: LiveSubstitution[];
  absentIds: string[];
};

// Herramienta seleccionada en la paleta: un tipo de evento, o 'absent' (quitar
// al que no viene, F7.5 — no es un match_event, es una baja).
type Tool = EventType | 'absent';

// Hora actual (ms) del instante del evento. A nivel de módulo a propósito: solo
// se invoca desde event handlers (registrar/cambiar), donde leer el reloj es
// correcto; así no la confunde el análisis de pureza de render.
const eventNowMs = () => Date.now();

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
  benchPlayers,
  substitutions,
  absentIds,
}: Props) {
  const t = useTranslations('partido_directo');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [side, setSide] = useState<MatchSide>('own');
  const [selectedEvent, setSelectedEvent] = useState<Tool | null>(null);
  // Eventos registrados en este cliente aún no reflejados por el servidor
  // (registro optimista, OVERLAY). Se superponen a los persistidos por id; nunca
  // los borran. La fuente de verdad es `recentEvents` (match_events persistidos),
  // que ahora SÍ se cargan (el embed de players estaba ambiguo → venía vacío).
  const [optimistic, setOptimistic] = useState<LiveMatchEvent[]>([]);
  // F7.5 — overlays optimistas de sustituciones y ausencias (mismo principio:
  // superponen a lo persistido; la verdad se recompone al refrescar).
  const [optimisticSubs, setOptimisticSubs] = useState<LiveSubstitution[]>([]);
  const [absentOverride, setAbsentOverride] = useState<Record<string, boolean>>({});
  // Jugador del campo elegido para SALIR (paso 1 de la sustitución).
  const [subOut, setSubOut] = useState<string | null>(null);

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

  // Lista mostrada = PERSISTIDOS (autoritativos) + OVERLAY optimista (dedupe por
  // id). Los persistidos nunca se borran; lo optimista solo se superpone hasta
  // que el servidor lo confirma. Más recientes primero.
  const events: LiveMatchEvent[] = mergeLiveEvents(recentEvents, optimistic);

  // Expulsados = estado DERIVADO de TODOS los eventos (1 roja O 2 amarillas,
  // §3.4 bis): SALEN del campo y no reciben más eventos. Se recomputa al hidratar
  // → un expulsado sigue fuera tras recargar/volver.
  const expelledIds = deriveExpelledPlayers(events);

  // Datos (nombre/dorsal/foto) de TODO el convocado, para pintar a quien entra.
  const playerInfo = new Map<
    string,
    { label: string; dorsal: number | null; photoUrl: string | null }
  >();
  for (const p of fieldPlayers)
    playerInfo.set(p.playerId, { label: p.label, dorsal: p.dorsal, photoUrl: p.photoUrl });
  for (const p of benchPlayers)
    playerInfo.set(p.playerId, { label: p.label, dorsal: p.dorsal, photoUrl: p.photoUrl });

  // F7.5 — estado vivo del once, derivado de lo PERSISTIDO + overlay optimista:
  //   subs = persistidas + optimistas (dedupe por id, orden cronológico);
  //   ausentes = persistidas con override optimista;
  //   expulsados = de los eventos.
  const allSubs = [...substitutions];
  for (const s of optimisticSubs) {
    if (!allSubs.some((x) => x.id === s.id)) allSubs.push(s);
  }
  allSubs.sort((a, b) => a.clockSeconds - b.clockSeconds);
  const subsForSquad: Sub[] = allSubs.map((s) => ({ out: s.outId, in: s.inId }));

  const absentSet = new Set(absentIds);
  for (const [pid, isAbsent] of Object.entries(absentOverride)) {
    if (isAbsent) absentSet.add(pid);
    else absentSet.delete(pid);
  }

  const squad = deriveSquad({
    slots: fieldPlayers.map((p) => ({
      playerId: p.playerId,
      positionCode: p.positionCode,
      xPct: p.xPct,
      yPct: p.yPct,
    })),
    bench: benchPlayers.map((p) => p.playerId),
    subs: subsForSquad,
    expelled: expelledIds,
    absent: absentSet,
  });

  // Jugadores EN EL CAMPO ahora (titulares + entrados, menos salidos/expulsados/
  // ausentes), con nombre/dorsal/foto de quien ocupe el hueco.
  const players: FieldEditorPlayer[] = squad.onField.map((slot) => {
    const info = playerInfo.get(slot.playerId);
    return {
      playerId: slot.playerId,
      label: info?.label ?? slot.playerId.slice(0, 4),
      dorsal: info?.dorsal ?? null,
      photoUrl: info?.photoUrl ?? null,
      positionCode: slot.positionCode,
      xPct: slot.xPct,
      yPct: slot.yPct,
    };
  });

  const onFieldIds = new Set(squad.onFieldIds);
  const eligibleInIds = new Set(squad.eligibleInIds);
  // Ausentes (titulares + suplentes) para poder deshacer la baja.
  const absentList = [...absentSet]
    .map((pid) => ({ playerId: pid, ...(playerInfo.get(pid) ?? { label: pid.slice(0, 4), dorsal: null, photoUrl: null }) }))
    .sort((a, b) => (a.dorsal ?? 99) - (b.dorsal ?? 99));

  // Tipos de eventos propios ya registrados de un jugador (para la regla de
  // tarjetas en el cliente; el servidor es el autoritativo).
  function ownTypesOf(playerId: string): string[] {
    return events.filter((e) => e.playerId === playerId).map((e) => e.type);
  }

  // F7.3 — registrar un evento sobre un jugador propio. side/clock/period los
  // resuelve el servidor; aquí pintamos optimista y confirmamos con refresh.
  function handlePlayerClick(playerId: string) {
    if (!selectedEvent) {
      toast.info(t('register_select_event'));
      return;
    }
    // F7.5 — "quitar al que no viene": no exige partido en vivo.
    if (selectedEvent === 'absent') {
      markAbsent(playerId, true);
      return;
    }
    if (matchStatus !== 'live') {
      toast.warning(t('register_not_live'));
      return;
    }
    // F7.5 — sustitución: tocar un jugador del campo lo marca como QUE SALE.
    if (selectedEvent === 'substitution') {
      if (!onFieldIds.has(playerId)) {
        toast.info(t('sub_pick_out'));
        return;
      }
      setSubOut(playerId);
      toast.info(t('sub_pick_in'));
      return;
    }
    if (!isPlayerEventType(selectedEvent)) {
      toast.info(t('register_not_player_event'));
      return;
    }

    const type = selectedEvent;
    const p = fieldPlayers.find((x) => x.playerId === playerId);
    const label = p?.label ?? playerId.slice(0, 4);

    // Regla de tarjetas/expulsión (espejo del servidor, para feedback inmediato).
    const priorTypes = ownTypesOf(playerId);
    const outcome = resolveCardOutcome(priorTypes, type);
    if (outcome.kind === 'blocked') {
      toast.warning(t(`event_error.${outcome.reason}`));
      return;
    }

    // id de cliente → reintento idempotente (§10). Reloj optimista con el motor
    // de 7.7; el servidor recalcula el autoritativo al insertar.
    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, eventNowMs());
    const cur = currentPeriod(periods);
    const period = cur?.period ?? 'first_half';
    const displayMinute = toDisplayMinute(clockSeconds);

    // La 2ª amarilla se registra como una amarilla MÁS (no se crea roja): la
    // expulsión es estado derivado (1 roja O 2 amarillas) → sale del campo solo.
    const optimisticRow: LiveMatchEvent = {
      id,
      type,
      playerId,
      playerLabel: label,
      dorsal: p?.dorsal ?? null,
      clockSeconds,
      displayMinute,
      period,
    };
    const expelledNow = isExpelled([...priorTypes, type]);
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
      const expelled = res.expelled ?? expelledNow;
      if (expelled && type === 'yellow_card') {
        toast.success(t('event_expelled_double_yellow', { player: label }));
      } else if (expelled) {
        toast.success(t('event_expelled_red', { player: label, minute: displayMinute }));
      } else {
        toast.success(
          t('event_registered', {
            event: t(`event.${type}`),
            player: label,
            minute: displayMinute,
          }),
        );
      }
      router.refresh();
    });
  }

  // F7.4 — registrar un evento sobre el CÉSPED (córner, falta, fuera de juego,
  // tiro) por ubicación (x/y), sin jugador. Mismo flujo optimista que 7.3.
  function handleFieldClick(xPct: number, yPct: number) {
    if (matchStatus !== 'live') {
      toast.warning(t('register_not_live'));
      return;
    }
    if (!selectedEvent) {
      toast.info(t('register_select_event'));
      return;
    }
    if (!isFieldEventType(selectedEvent)) {
      toast.info(t('register_not_field_event'));
      return;
    }

    const type = selectedEvent;
    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, eventNowMs());
    const cur = currentPeriod(periods);
    const period = cur?.period ?? 'first_half';
    const displayMinute = toDisplayMinute(clockSeconds);

    const optimisticRow: LiveMatchEvent = {
      id,
      type,
      playerId: null, // evento de campo: por ubicación, sin jugador
      playerLabel: '',
      dorsal: null,
      clockSeconds,
      displayMinute,
      period,
    };
    setOptimistic((prev) => [optimisticRow, ...prev]);
    setSelectedEvent(null);

    startTransition(async () => {
      const res = await registerFieldEvent({
        event_id: eventId,
        id,
        type,
        x_pct: xPct,
        y_pct: yPct,
      });
      if (res.error) {
        setOptimistic((prev) => prev.filter((e) => e.id !== id));
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      toast.success(
        t('event_registered_field', {
          event: t(`event.${type}`),
          minute: displayMinute,
        }),
      );
      router.refresh();
    });
  }

  // F7.5 — "quitar al que no viene" / deshacer: marca o desmarca ausencia.
  // Optimista (override) + persistencia. No exige partido en vivo.
  function markAbsent(playerId: string, absent: boolean) {
    setAbsentOverride((prev) => ({ ...prev, [playerId]: absent }));
    setSelectedEvent(null);
    if (subOut === playerId) setSubOut(null);
    const label = playerInfo.get(playerId)?.label ?? playerId.slice(0, 4);
    startTransition(async () => {
      const res = await setPlayerAbsent({ event_id: eventId, player_id: playerId, absent });
      if (res.error) {
        setAbsentOverride((prev) => {
          const next = { ...prev };
          delete next[playerId];
          return next;
        });
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      toast.success(t(absent ? 'absent_marked' : 'absent_undone', { player: label }));
      router.refresh();
    });
  }

  // F7.5 — completar la sustitución: SALE `outId`, ENTRA `inId` (paso 2).
  function completeSub(outId: string, inId: string) {
    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, eventNowMs());
    const cur = currentPeriod(periods);
    const period = cur?.period ?? 'first_half';
    const displayMinute = toDisplayMinute(clockSeconds);
    const outLabel = playerInfo.get(outId)?.label ?? outId.slice(0, 4);
    const inLabel = playerInfo.get(inId)?.label ?? inId.slice(0, 4);

    const optimisticSub: LiveSubstitution = {
      id,
      outId,
      inId,
      outLabel,
      inLabel,
      clockSeconds,
      displayMinute,
      period,
    };
    setOptimisticSubs((prev) => [...prev, optimisticSub]);
    setSubOut(null);
    setSelectedEvent(null);

    startTransition(async () => {
      const res = await registerSubstitution({
        event_id: eventId,
        id,
        player_out_id: outId,
        player_in_id: inId,
      });
      if (res.error) {
        setOptimisticSubs((prev) => prev.filter((s) => s.id !== id));
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      toast.success(t('sub_registered', { out: outLabel, in: inLabel, minute: displayMinute }));
      router.refresh();
    });
  }

  // F7.5 — clic en un suplente del banquillo.
  function handleBenchClick(playerId: string) {
    if (selectedEvent === 'absent') {
      markAbsent(playerId, true);
      return;
    }
    // En medio de una sustitución: el suplente elegible ENTRA por el que sale.
    if (subOut) {
      if (!eligibleInIds.has(playerId)) {
        toast.warning(t('sub_not_eligible'));
        return;
      }
      completeSub(subOut, playerId);
      return;
    }
    toast.info(t('sub_hint'));
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

      {/* F7.5 — sustitución en curso: aviso de quién sale + cancelar. */}
      {subOut && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          <span>
            {t('sub_out_label', {
              player: playerInfo.get(subOut)?.label ?? subOut.slice(0, 4),
            })}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSubOut(null)}>
            <X className="size-4" aria-hidden />
            <span>{t('sub_cancel')}</span>
          </Button>
        </div>
      )}

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
            {/* F7.5 — herramienta "quitar al que no viene" (no es match_event). */}
            <button
              type="button"
              onClick={() => setSelectedEvent(selectedEvent === 'absent' ? null : 'absent')}
              aria-pressed={selectedEvent === 'absent'}
              className={cn(
                'flex touch-none flex-col items-center gap-1 rounded-md border p-2 text-[11px] font-medium transition-colors',
                selectedEvent === 'absent'
                  ? 'border-amber-500 bg-amber-500/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <UserMinus className="size-5" aria-hidden />
              <span className="text-center leading-tight">{t('tool_absent')}</span>
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-tight text-muted-foreground">
            {selectedEvent === 'substitution'
              ? t('sub_hint')
              : selectedEvent === 'absent'
                ? t('absent_hint')
                : t('palette_hint')}
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
            className="h-[56vh] max-h-[56vh] w-auto max-w-none"
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
                      {ev.playerId ? (
                        <>
                          {ev.dorsal != null ? `${ev.dorsal} · ` : ''}
                          {ev.playerLabel}
                        </>
                      ) : (
                        // Evento de campo (7.4): sin jugador → mostramos el tipo.
                        <span className="text-muted-foreground">
                          {t(`event.${ev.type}`)}
                        </span>
                      )}
                    </span>
                    <span className="sr-only">{t(`event.${ev.type}`)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* F7.5 — BANQUILLO: suplentes con su estado. En sustitución (sale elegido)
          los disponibles ENTRAN; con la herramienta "ausente" se marca la baja. */}
      <div className="rounded-lg border border-border bg-card/40 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('bench_title')}
        </p>
        {squad.bench.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('bench_empty')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {squad.bench.map((b) => {
              const info = playerInfo.get(b.playerId);
              const label = info?.label ?? b.playerId.slice(0, 4);
              const dorsal = info?.dorsal ?? null;
              const clickable =
                selectedEvent === 'absent' ||
                (subOut != null && b.status === 'available');
              return (
                <button
                  key={b.playerId}
                  type="button"
                  disabled={!clickable}
                  onClick={() => handleBenchClick(b.playerId)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors',
                    clickable
                      ? 'border-primary/50 hover:bg-primary/10'
                      : 'border-border',
                    b.status === 'available' && 'text-foreground',
                    b.status !== 'available' && 'text-muted-foreground',
                  )}
                >
                  {dorsal != null && (
                    <span className="font-mono text-xs tabular-nums">{dorsal}</span>
                  )}
                  <span className="truncate">{label}</span>
                  {b.status !== 'available' && (
                    <span
                      className={cn(
                        'rounded px-1 text-[10px] uppercase',
                        b.status === 'expelled' && 'bg-red-500/15 text-red-600 dark:text-red-400',
                        b.status === 'absent' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                        b.status === 'entered' && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {t(`bench_status.${b.status}`)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Ausentes (titulares + suplentes): deshacer la baja. */}
        {absentList.length > 0 && (
          <div className="mt-3 border-t border-border/60 pt-2">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('absent_title')}
            </p>
            <div className="flex flex-wrap gap-2">
              {absentList.map((p) => (
                <button
                  key={p.playerId}
                  type="button"
                  onClick={() => markAbsent(p.playerId, false)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  aria-label={t('absent_undo_aria', { player: p.label })}
                >
                  <RotateCcw className="size-3" aria-hidden />
                  {p.dorsal != null ? `${p.dorsal} · ` : ''}
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
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
