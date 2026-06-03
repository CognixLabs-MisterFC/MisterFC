'use client';

/**
 * F7.2–7.6 — Pantalla de toma de datos en directo (HORIZONTAL, tablet/portátil
 * táctil tipo Chromebook).
 *
 * F7.6 — RIVAL EN LA MISMA PANTALLA (sin toggle equipo/rival). Columnas a lo
 * ancho: [nuestros eventos] · [banquillo] · [campo] · [rival] · [eventos del
 * rival], con una franja de ESTADÍSTICAS abajo (placeholder hasta 7.8). El rival
 * NO tiene roster (§3.4): se registra por DORSAL + nota libre, side='rival'.
 * Persiste e hidrata igual que lo nuestro. Las tarjetas del rival son
 * informativas (no hay banquillo rival que gestionar).
 *
 * Reaprovecha el patrón estable de 7.3–7.5: registro OPTIMISTA + hidratación
 * desde match_events persistidos, y `deriveSquad` para el once vivo — con el
 * RÉGIMEN de cambios de 7.6c (de la categoría+división del equipo): corrido
 * (ilimitado + reentrada) o limitado (tope de cambios + sin reentrada).
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
  LayoutGrid,
  Move,
  RotateCcw,
  Square,
  Target,
  UserMinus,
  X,
} from 'lucide-react';
import {
  assignPlayersToFormation,
  canRegisterSubstitution,
  clampPct,
  clockSecondsAt,
  currentPeriod,
  deriveExpelledPlayers,
  deriveSquad,
  displayMinute as toDisplayMinute,
  formationsForFormat,
  getFormation,
  isExpelled,
  isFieldEventType,
  isPlayerEventType,
  mergeLiveEvents,
  resolveCardOutcome,
  RIVAL_EVENT_TYPES,
  type ClockPeriod,
  type LivePositions,
  type MatchEventLite,
  type RivalEventType,
  type Sub,
  type SubstitutionRegime,
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
  LiveFormationChange,
  LiveMatchEvent,
  LiveRivalEvent,
  LiveStatEvent,
  LiveSubstitution,
} from '../queries';
import {
  changeFormation,
  movePlayer,
  registerFieldEvent,
  registerPlayerEvent,
  registerRivalEvent,
  registerSubstitution,
  setPlayerAbsent,
} from '../actions';
import { MatchClock, MatchClockOverlay } from './match-clock';
import { PlayerStatsStrip, type StatsPlayer } from './player-stats-strip';

// Tipos de evento de la paleta propia (coinciden con match_events.type de F7.1).
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
  rivalEvents: LiveRivalEvent[];
  regime: SubstitutionRegime;
  liveFormationCode: string | null;
  livePositions: LivePositions;
  formationChanges: LiveFormationChange[];
  /** F7.8 — once inicial congelado (match_starters): base de los minutos (§6). */
  starterIds: string[];
  /** F7.8 — eventos propios contables (gol/asistencia/tarjetas), lista completa. */
  statEvents: LiveStatEvent[];
};

// Herramienta seleccionada en la paleta propia: un tipo de evento, o 'absent'
// (quitar al que no viene, F7.5 — no es un match_event, es una baja).
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
  rivalEvents,
  regime,
  liveFormationCode,
  livePositions,
  formationChanges,
  starterIds,
  statEvents,
}: Props) {
  const t = useTranslations('partido_directo');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedEvent, setSelectedEvent] = useState<Tool | null>(null);
  // F7.6b — modo táctica (arrastrar para mover) vs captura de eventos (clic).
  const [tacticsMode, setTacticsMode] = useState(false);
  // Overlays optimistas del estado táctico (posiciones + formación).
  const [optimisticPositions, setOptimisticPositions] = useState<LivePositions>({});
  const [optimisticFormation, setOptimisticFormation] = useState<string | null>(null);
  const [optimisticFormationChanges, setOptimisticFormationChanges] = useState<
    LiveFormationChange[]
  >([]);
  // Overlays optimistas (OVERLAY sobre lo persistido; nunca lo borran — la
  // verdad se recompone al refrescar). Ver invariante de hidratación de 7.3.
  const [optimistic, setOptimistic] = useState<LiveMatchEvent[]>([]);
  const [optimisticSubs, setOptimisticSubs] = useState<LiveSubstitution[]>([]);
  const [optimisticRival, setOptimisticRival] = useState<LiveRivalEvent[]>([]);
  const [absentOverride, setAbsentOverride] = useState<Record<string, boolean>>({});
  // Jugador del campo elegido para SALIR (paso 1 de la sustitución).
  const [subOut, setSubOut] = useState<string | null>(null);
  // F7.6 — registro del rival: dorsal + nota libre.
  const [rivalDorsal, setRivalDorsal] = useState('');
  const [rivalNote, setRivalNote] = useState('');

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
  // id). Más recientes primero.
  const events: LiveMatchEvent[] = mergeLiveEvents(recentEvents, optimistic);
  const rivalAll: LiveRivalEvent[] = mergeLiveEvents(rivalEvents, optimisticRival);

  // F7.6b — "Últimos eventos" = eventos propios + CAMBIOS DE TÁCTICA (fuente
  // única: match_events 'formation_change'), intercalados por reloj (recientes 1º).
  const allFormationChanges = mergeLiveEvents(formationChanges, optimisticFormationChanges);
  type TimelineItem =
    | { kind: 'event'; clockSeconds: number; ev: LiveMatchEvent }
    | { kind: 'formation'; clockSeconds: number; fc: LiveFormationChange };
  const timeline: TimelineItem[] = [
    ...events.map((ev) => ({ kind: 'event' as const, clockSeconds: ev.clockSeconds, ev })),
    ...allFormationChanges.map((fc) => ({
      kind: 'formation' as const,
      clockSeconds: fc.clockSeconds,
      fc,
    })),
  ].sort((a, b) => b.clockSeconds - a.clockSeconds);

  // Expulsados PROPIOS = estado DERIVADO de TODOS los eventos (1 roja O 2
  // amarillas, §3.4 bis). Se recomputa al hidratar.
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

  // Once vivo derivado de lo PERSISTIDO + overlay optimista.
  const allSubs = [...substitutions];
  for (const s of optimisticSubs) {
    if (!allSubs.some((x) => x.id === s.id)) allSubs.push(s);
  }
  allSubs.sort((a, b) => a.clockSeconds - b.clockSeconds);
  const subsForSquad: Sub[] = allSubs.map((s) => ({ out: s.outId, in: s.inId }));
  // F7.6c — cambios hechos (cuenta de sustituciones) para el tope del régimen.
  const subsSoFar = allSubs.length;
  const canSub = canRegisterSubstitution(regime, subsSoFar);

  const absentSet = new Set(absentIds);
  for (const [pid, isAbsent] of Object.entries(absentOverride)) {
    if (isAbsent) absentSet.add(pid);
    else absentSet.delete(pid);
  }

  // F7.6b — estado táctico EFECTIVO = persistido + overlay optimista. La
  // formación viva manda sobre la oficial; las posiciones movidas hacen override
  // del slot oficial. Todo se hidrata al recargar (no es efímero).
  const effectiveLivePositions: LivePositions = { ...livePositions, ...optimisticPositions };
  const currentFormationCode = optimisticFormation ?? liveFormationCode ?? formationCode;

  // `deriveSquad` resuelve la posición efectiva de cada hueco (incl. herencia: el
  // que entra hereda la posición ACTUAL del que salió por la cadena de ocupantes).
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
    allowReentry: regime.allowReentry,
    positions: effectiveLivePositions,
  });

  // Jugadores EN EL CAMPO ahora, con nombre/dorsal/foto de quien ocupe el hueco;
  // la posición ya viene resuelta por deriveSquad (viva/heredada/slot oficial).
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

  // Rival: dorsales expulsados (informativo) — 1 roja O 2 amarillas por dorsal.
  const rivalCardsByDorsal = new Map<number, string[]>();
  for (const e of rivalAll) {
    if (e.dorsal == null) continue;
    if (e.type === 'yellow_card' || e.type === 'red_card') {
      const arr = rivalCardsByDorsal.get(e.dorsal) ?? [];
      arr.push(e.type);
      rivalCardsByDorsal.set(e.dorsal, arr);
    }
  }
  const rivalExpelledDorsals = new Set(
    [...rivalCardsByDorsal.entries()].filter(([, types]) => isExpelled(types)).map(([d]) => d),
  );

  // F7.8 — datos de la TABLA de tiempo de juego y stats por jugador. Vista
  // calculada en vivo (no materializa nada; eso es 7.10). Eventos contables
  // COMPLETOS (statEvents, sin el limit de recentEvents) + overlay optimista,
  // deduplicados por id. El motor puro de core hace el cálculo de minutos.
  const CARD_STAT_TYPES = ['goal', 'assist', 'yellow_card', 'red_card'] as const;
  const optimisticStat: LiveStatEvent[] = optimistic
    .filter(
      (e): e is LiveMatchEvent & { type: LiveStatEvent['type'] } =>
        e.playerId != null &&
        (CARD_STAT_TYPES as readonly string[]).includes(e.type),
    )
    .map((e) => ({
      id: e.id,
      type: e.type,
      playerId: e.playerId,
      clockSeconds: e.clockSeconds,
    }));
  const statAll = mergeLiveEvents(statEvents, optimisticStat);
  const statEngineEvents: MatchEventLite[] = [
    ...allSubs.map((s) => ({
      type: 'substitution',
      playerId: s.outId,
      relatedPlayerId: s.inId,
      clockSeconds: s.clockSeconds,
    })),
    ...statAll.map((e) => ({
      type: e.type,
      playerId: e.playerId,
      clockSeconds: e.clockSeconds,
    })),
  ];
  // Convocado a mostrar = once oficial + banquillo (+ titulares congelados que no
  // figuren, defensivo), en orden de visualización, sin duplicados.
  const statsRoster: StatsPlayer[] = [];
  const seenRoster = new Set<string>();
  for (const p of [...fieldPlayers, ...benchPlayers]) {
    if (seenRoster.has(p.playerId)) continue;
    seenRoster.add(p.playerId);
    statsRoster.push({ playerId: p.playerId, label: p.label, dorsal: p.dorsal });
  }
  for (const pid of starterIds) {
    if (seenRoster.has(pid)) continue;
    seenRoster.add(pid);
    const info = playerInfo.get(pid);
    statsRoster.push({
      playerId: pid,
      label: info?.label ?? pid.slice(0, 4),
      dorsal: info?.dorsal ?? null,
    });
  }

  // Tipos de eventos propios ya registrados de un jugador (regla de tarjetas en
  // el cliente; el servidor es el autoritativo).
  function ownTypesOf(playerId: string): string[] {
    return events.filter((e) => e.playerId === playerId).map((e) => e.type);
  }

  // F7.3 — registrar un evento sobre un jugador propio.
  function handlePlayerClick(playerId: string) {
    if (!selectedEvent) {
      toast.info(t('register_select_event'));
      return;
    }
    if (selectedEvent === 'absent') {
      markAbsent(playerId, true);
      return;
    }
    if (matchStatus !== 'live') {
      toast.warning(t('register_not_live'));
      return;
    }
    if (selectedEvent === 'substitution') {
      // F7.6c — régimen limitado: bloquea iniciar el cambio nº (max+1).
      if (!canSub) {
        toast.warning(t('event_error.sub_limit_reached'));
        return;
      }
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

    const priorTypes = ownTypesOf(playerId);
    const outcome = resolveCardOutcome(priorTypes, type);
    if (outcome.kind === 'blocked') {
      toast.warning(t(`event_error.${outcome.reason}`));
      return;
    }

    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, eventNowMs());
    const cur = currentPeriod(periods);
    const period = cur?.period ?? 'first_half';
    const displayMinute = toDisplayMinute(clockSeconds);

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
    setSelectedEvent(null);

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
  // tiro) por ubicación (x/y), sin jugador.
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
      playerId: null,
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

  // F7.5 — "quitar al que no viene" / deshacer.
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

  // F7.5 — completar la sustitución: SALE `outId`, ENTRA `inId`.
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

  // F7.5 — clic en un jugador del banquillo (suplente o el que salió y puede volver).
  function handleBenchClick(playerId: string) {
    if (selectedEvent === 'absent') {
      markAbsent(playerId, true);
      return;
    }
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

  // F7.6 — registrar un evento del RIVAL (por dorsal + nota libre).
  function registerRival(type: RivalEventType) {
    if (matchStatus !== 'live') {
      toast.warning(t('register_not_live'));
      return;
    }
    const dorsalNum = Number(rivalDorsal);
    if (!Number.isInteger(dorsalNum) || dorsalNum < 1 || dorsalNum > 99) {
      toast.warning(t('rival_dorsal_required'));
      return;
    }

    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, eventNowMs());
    const cur = currentPeriod(periods);
    const period = cur?.period ?? 'first_half';
    const displayMinute = toDisplayMinute(clockSeconds);
    const note = rivalNote.trim() || null;

    const optimisticRow: LiveRivalEvent = {
      id,
      type,
      dorsal: dorsalNum,
      note,
      clockSeconds,
      displayMinute,
      period,
    };
    setOptimisticRival((prev) => [optimisticRow, ...prev]);
    setRivalNote('');

    startTransition(async () => {
      const res = await registerRivalEvent({
        event_id: eventId,
        id,
        type,
        rival_dorsal: dorsalNum,
        note: note ?? undefined,
      });
      if (res.error) {
        setOptimisticRival((prev) => prev.filter((e) => e.id !== id));
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      toast.success(
        t('rival_registered', {
          event: t(`event.${type}`),
          dorsal: dorsalNum,
          minute: displayMinute,
        }),
      );
      router.refresh();
    });
  }

  // F7.6b — mover un jugador del campo: nueva posición (x/y) optimista + persistir.
  function handlePlayerMove(playerId: string, xPct: number, yPct: number) {
    if (matchStatus !== 'live') {
      toast.warning(t('register_not_live'));
      return;
    }
    const prev = optimisticPositions;
    const positionCode =
      optimisticPositions[playerId]?.positionCode ??
      livePositions[playerId]?.positionCode ??
      null;
    setOptimisticPositions((p) => ({
      ...p,
      [playerId]: { positionCode, xPct: clampPct(xPct), yPct: clampPct(yPct) },
    }));
    startTransition(async () => {
      const res = await movePlayer({
        event_id: eventId,
        player_id: playerId,
        x_pct: clampPct(xPct),
        y_pct: clampPct(yPct),
      });
      if (res.error) {
        setOptimisticPositions(prev);
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      router.refresh();
    });
  }

  // F7.6b — cambiar la formación entera: recoloca a los del campo en los nuevos
  // slots (optimista) + persistir. Reusa el reparto puro de @misterfc/core.
  function handleChangeFormation(code: string) {
    if (code === currentFormationCode) return;
    if (matchStatus !== 'live') {
      toast.warning(t('register_not_live'));
      return;
    }
    const formation = getFormation(code);
    if (!formation) return;
    const current = players.map((p) => ({
      playerId: p.playerId,
      xPct: p.xPct ?? 50,
      yPct: p.yPct ?? 50,
    }));
    const assigned = assignPlayersToFormation(current, formation);
    const fromCode = currentFormationCode;
    // id de cliente: el optimista y el match_event persistido comparten id →
    // mergeLiveEvents deduplica al hidratar (no hay fila duplicada).
    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, eventNowMs());
    const cur = currentPeriod(periods);
    const period = cur?.period ?? 'first_half';
    const changeRow: LiveFormationChange = {
      id,
      from: fromCode,
      to: code,
      clockSeconds,
      displayMinute: toDisplayMinute(clockSeconds),
      period,
    };
    const prevPositions = optimisticPositions;
    const prevFormation = optimisticFormation;
    setOptimisticFormation(code);
    setOptimisticPositions((p) => ({ ...p, ...assigned }));
    setOptimisticFormationChanges((p) => [...p, changeRow]);
    startTransition(async () => {
      const res = await changeFormation({ event_id: eventId, id, formation_code: code });
      if (res.error) {
        setOptimisticFormation(prevFormation);
        setOptimisticPositions(prevPositions);
        setOptimisticFormationChanges((p) => p.filter((c) => c.id !== id));
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      toast.success(t('formation_changed', { formation: code }));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Cronómetro completo (F7.7). */}
      <div className="rounded-lg border border-border bg-card/40 p-3">
        <MatchClock
          eventId={eventId}
          status={matchStatus}
          periods={periods}
          halfDurationMinutes={halfDurationMinutes}
        />
      </div>

      {/* Paleta de eventos PROPIOS (toolbar horizontal). */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 p-2">
        <span className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('palette_title')}
        </span>
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
                'flex touch-none items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className={cn('size-4', EVENT_ICON_CLASS[ev])} aria-hidden />
              <span>{t(`event.${ev}`)}</span>
            </button>
          );
        })}
        {/* F7.5 — herramienta "quitar al que no viene" (no es match_event). */}
        <button
          type="button"
          onClick={() => setSelectedEvent(selectedEvent === 'absent' ? null : 'absent')}
          aria-pressed={selectedEvent === 'absent'}
          className={cn(
            'flex touch-none items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
            selectedEvent === 'absent'
              ? 'border-amber-500 bg-amber-500/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          <UserMinus className="size-4" aria-hidden />
          <span>{t('tool_absent')}</span>
        </button>

        {/* F7.6b — separador + modo táctica (mover/cambiar formación). */}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <button
          type="button"
          onClick={() => {
            setTacticsMode((v) => !v);
            setSelectedEvent(null);
          }}
          aria-pressed={tacticsMode}
          className={cn(
            'flex touch-none items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
            tacticsMode
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          <Move className="size-4" aria-hidden />
          <span>{t('tactics_tool')}</span>
        </button>
        {tacticsMode && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t('formation_label')}</span>
            <select
              value={currentFormationCode}
              onChange={(e) => handleChangeFormation(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              aria-label={t('formation_label')}
            >
              {formationsForFormat(format).map((f) => (
                <option key={f.code} value={f.code}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <span className="ml-auto max-w-xs text-[11px] leading-tight text-muted-foreground">
          {tacticsMode
            ? t('tactics_hint')
            : selectedEvent === 'substitution'
              ? t('sub_hint')
              : selectedEvent === 'absent'
                ? t('absent_hint')
                : t('palette_hint')}
        </span>
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

      {/* Cuerpo a lo ancho: [nuestros eventos] · [banquillo] · [campo] · [rival]
          · [eventos del rival]. En táctil horizontal conviven; en estrecho se
          apilan. */}
      <div className="flex flex-col gap-3 xl:flex-row">
        {/* Columna 1 — nuestros eventos. */}
        <div className="rounded-lg border border-border bg-card/40 p-3 xl:order-1 xl:w-48 xl:shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('recent_events_title')}
          </p>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('no_events_yet')}</p>
          ) : (
            <ul className="flex max-h-[52vh] flex-col gap-1 overflow-y-auto">
              {timeline.map((item) => {
                if (item.kind === 'formation') {
                  const fc = item.fc;
                  return (
                    <li
                      key={fc.id}
                      className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-sm"
                    >
                      <span className="w-7 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {fc.displayMinute ?? Math.floor(fc.clockSeconds / 60)}&#39;
                      </span>
                      <LayoutGrid className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {t('formation_change_event', {
                          from: fc.from ?? '—',
                          to: fc.to,
                        })}
                      </span>
                    </li>
                  );
                }
                const ev = item.ev;
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
                        <span className="text-muted-foreground">{t(`event.${ev.type}`)}</span>
                      )}
                    </span>
                    <span className="sr-only">{t(`event.${ev.type}`)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Columna 2 — banquillo (suplentes + los que salieron). */}
        <div className="rounded-lg border border-border bg-card/40 p-3 xl:order-2 xl:w-44 xl:shrink-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('bench_title')}
            </p>
            {/* F7.6c — indicador del régimen: corrido o "Cambios n/max". */}
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] uppercase',
                regime.type === 'rolling'
                  ? 'bg-primary/10 text-primary'
                  : canSub
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-red-500/15 text-red-600 dark:text-red-400',
              )}
            >
              {regime.type === 'rolling'
                ? t('reentry_on')
                : t('subs_count', { n: subsSoFar, max: regime.maxSubs ?? 0 })}
            </span>
          </div>
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
                      clickable ? 'border-primary/50 hover:bg-primary/10' : 'border-border',
                      b.status === 'available' ? 'text-foreground' : 'text-muted-foreground',
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
                          b.status === 'out' && 'bg-muted text-muted-foreground',
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

        {/* Columna 3 — campo (centro). */}
        <div className="flex min-w-0 flex-1 items-start justify-center rounded-lg border border-border bg-card/20 p-3 xl:order-3">
          <MatchFieldEditor
            format={format}
            formationCode={currentFormationCode}
            players={players}
            mode={tacticsMode ? 'live-tactics' : 'live-overlay'}
            onPlayerClick={handlePlayerClick}
            onFieldClick={handleFieldClick}
            onPlayerMove={handlePlayerMove}
            className={cn(
              'h-[50vh] max-h-[50vh] w-auto max-w-none',
              tacticsMode && 'ring-2 ring-primary',
            )}
          >
            <MatchClockOverlay periods={periods} />
          </MatchFieldEditor>
        </div>

        {/* Columna 4 — RIVAL: registro por dorsal + nota libre (F7.6). */}
        <div className="rounded-lg border border-border bg-card/40 p-3 xl:order-4 xl:w-52 xl:shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {opponentName ? `${t('rival_panel_title')} · ${opponentName}` : t('rival_panel_title')}
          </p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-12 shrink-0">{t('rival_dorsal_label')}</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rivalDorsal}
                onChange={(e) =>
                  setRivalDorsal(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))
                }
                placeholder={t('rival_dorsal_placeholder')}
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-center text-base font-mono tabular-nums text-foreground"
                aria-label={t('rival_dorsal_label')}
              />
            </label>
            <input
              type="text"
              value={rivalNote}
              onChange={(e) => setRivalNote(e.target.value.slice(0, 200))}
              placeholder={t('rival_note_placeholder')}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              aria-label={t('rival_note_label')}
            />
            <p className="text-[11px] leading-tight text-muted-foreground">{t('rival_hint')}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {RIVAL_EVENT_TYPES.map((ev) => {
                const Icon = EVENT_ICON[ev];
                return (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => registerRival(ev)}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <Icon className={cn('size-4', EVENT_ICON_CLASS[ev])} aria-hidden />
                    <span className="truncate">{t(`event.${ev}`)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Columna 5 — eventos del rival (F7.6). */}
        <div className="rounded-lg border border-border bg-card/40 p-3 xl:order-5 xl:w-48 xl:shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('rival_events_title')}
          </p>
          {rivalAll.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('rival_no_events')}</p>
          ) : (
            <ul className="flex max-h-[52vh] flex-col gap-1 overflow-y-auto">
              {rivalAll.map((ev) => {
                const Icon = EVENT_ICON[ev.type];
                const expelled = ev.dorsal != null && rivalExpelledDorsals.has(ev.dorsal);
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
                      {ev.dorsal != null && (
                        <span className="font-mono tabular-nums">#{ev.dorsal}</span>
                      )}
                      {ev.note ? (
                        <span className="text-muted-foreground"> · {ev.note}</span>
                      ) : (
                        <span className="text-muted-foreground"> · {t(`event.${ev.type}`)}</span>
                      )}
                    </span>
                    {expelled && (
                      <span className="shrink-0 rounded bg-red-500/15 px-1 text-[10px] uppercase text-red-600 dark:text-red-400">
                        {t('rival_expelled')}
                      </span>
                    )}
                    <span className="sr-only">{t(`event.${ev.type}`)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Franja de ESTADÍSTICAS — tiempo de juego y stats por jugador (F7.8). */}
      <PlayerStatsStrip
        periods={periods}
        matchStatus={matchStatus}
        players={statsRoster}
        starterIds={starterIds}
        events={statEngineEvents}
        absentIds={[...absentSet]}
        expelledIds={[...expelledIds]}
      />

      <p className="text-center text-xs text-muted-foreground xl:hidden">
        {t('landscape_hint')}
      </p>
      <p className="text-center text-[11px] text-muted-foreground">
        {eventType === 'friendly' ? t('friendly_note') : t('scope_note')}
      </p>
    </div>
  );
}
