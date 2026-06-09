'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  BENCH_ZONE_ID,
  applyDrop,
  defaultFormation,
  exceedsStarters,
  formationsForFormat,
  getFormation,
  parsePlayerDragId,
  playerDraggableId,
  coachFormationToFormation,
  positionKeyOfSlotCode,
  resolveDrop,
  startersFor,
  type CoachFormation,
  type Formation,
  type PlayerPositionMain,
  type PositionAssignment,
  type SlotRole,
  type TeamFormat,
} from '@misterfc/core';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { PlayerAvatar } from '@/components/match/player-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  createLineup,
  createPlannedSub,
  deletePlannedSub,
  setLineupFormation,
  setLineupName,
  setLineupOfficial,
  setLineupVisibility,
  setTacticalNotes,
  upsertLineupPosition,
} from '../actions';
import { upsertCallupDecision } from '../../../actions';

export type RosterPlayerVM = {
  playerId: string;
  firstName: string;
  lastName: string;
  dorsal: number | null;
  positionMain: PlayerPositionMain;
  photoUrl: string | null;
};

export type LineupSummaryVM = {
  id: string;
  name: string;
  formationCode: string;
  isOfficial: boolean;
  visibility: 'staff' | 'team';
};

export type PlannedSubVM = {
  id: string;
  minutePlanned: number;
  playerOutId: string;
  playerInId: string;
  positionCodeTarget: string | null;
};

export type DiscardedVM = { playerId: string; reason: string | null };

// Zona de descarte: NIVEL EVENTO (callup_decisions), no una location del lineup.
// Por eso su id vive aquí y se maneja fuera de resolveDrop (core solo conoce
// field/bench).
const DISCARDED_ZONE_ID = 'lineup-zone:discarded';

const DISCARD_REASONS = ['tecnico', 'fisico', 'disciplinario', 'personal'] as const;

// Slot vacío del catálogo: etiqueta por rol vía i18n `alineacion.pos_short.*`.
const ROLE_TO_SHORT: Record<SlotRole, string> = {
  GK: 'goalkeeper',
  DF: 'defender',
  MF: 'midfielder',
  FW: 'forward',
};
type DiscardReason = (typeof DISCARD_REASONS)[number];

type Props = {
  eventId: string;
  format: TeamFormat;
  roster: RosterPlayerVM[];
  discarded: DiscardedVM[];
  lineups: LineupSummaryVM[];
  selectedLineupId: string | null;
  selectedFormationCode: string | null;
  selectedIsOfficial: boolean;
  selectedVisibility: 'staff' | 'team';
  initialPositions: PositionAssignment[];
  initialTacticalNotes: string | null;
  initialPlannedSubs: PlannedSubVM[];
  /** F6.10 — plantillas personalizadas del coach para esta modalidad. */
  coachFormations: CoachFormation[];
};

function shortLabel(p: RosterPlayerVM | undefined, playerId: string): string {
  if (!p) return playerId.slice(0, 4);
  return p.lastName || p.firstName || playerId.slice(0, 4);
}

/**
 * Siembra como banquillo a los convocados que aún no tienen posición. Excluye a
 * los descartados (nivel evento) — el roster que llega incluye a todos.
 */
function mergeInitial(
  positions: PositionAssignment[],
  roster: RosterPlayerVM[],
  discardedIds: Set<string>,
): PositionAssignment[] {
  const present = new Set(positions.map((p) => p.playerId));
  const extra: PositionAssignment[] = roster
    .filter((r) => !present.has(r.playerId) && !discardedIds.has(r.playerId))
    .map((r) => ({
      playerId: r.playerId,
      location: 'bench',
      positionCode: null,
      xPct: null,
      yPct: null,
    }));
  return [...positions, ...extra];
}

function DropZone({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-24 flex-col gap-1.5 rounded-md border border-dashed border-border p-2 transition-colors',
        isOver && 'border-emerald-500 bg-emerald-500/10',
      )}
    >
      {children}
    </div>
  );
}

function PlayerPill({
  playerId,
  player,
  positionLabel,
  subLabel,
}: {
  playerId: string;
  player: RosterPlayerVM | undefined;
  positionLabel: string | null;
  subLabel?: string | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: playerDraggableId(playerId),
  });
  const label = shortLabel(player, playerId);
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={cn(
        'flex w-full cursor-grab touch-none items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-sm active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
      {...listeners}
      {...attributes}
    >
      <PlayerAvatar
        firstName={player?.firstName ?? ''}
        lastName={player?.lastName ?? ''}
        photoUrl={player?.photoUrl ?? null}
        size="sm"
      />
      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {player?.dorsal ?? '·'}
      </span>
      {positionLabel && (
        <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
          {positionLabel}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {subLabel && (
          <span className="truncate text-[10px] text-muted-foreground">
            {subLabel}
          </span>
        )}
      </span>
    </button>
  );
}

export function LineupEditorClient(props: Props) {
  const {
    eventId,
    format,
    roster,
    discarded: initialDiscarded,
    lineups,
    selectedLineupId,
    selectedFormationCode,
    selectedIsOfficial,
    selectedVisibility,
    initialPositions,
    initialTacticalNotes,
    initialPlannedSubs,
    coachFormations,
  } = props;

  const t = useTranslations('alineacion');
  const tp = useTranslations('positions');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rosterById = useMemo(
    () => new Map(roster.map((r) => [r.playerId, r])),
    [roster],
  );

  const posLabelOf = (playerId: string): string | null => {
    const pm = rosterById.get(playerId)?.positionMain;
    return pm ? t(`pos_short.${pm}`) : null;
  };

  const [discarded, setDiscarded] = useState<DiscardedVM[]>(initialDiscarded);
  const discardedIds = useMemo(
    () => new Set(discarded.map((d) => d.playerId)),
    [discarded],
  );

  const [positions, setPositions] = useState<PositionAssignment[]>(() =>
    mergeInitial(
      initialPositions,
      roster,
      new Set(initialDiscarded.map((d) => d.playerId)),
    ),
  );
  const [formationCode, setFormationCode] = useState<string>(
    selectedFormationCode ?? defaultFormation(format).code,
  );
  const [visibility, setVisibility] = useState<'staff' | 'team'>(selectedVisibility);
  const [notes, setNotes] = useState<string>(initialTacticalNotes ?? '');
  const [showNotes, setShowNotes] = useState<boolean>(
    (initialTacticalNotes ?? '').length > 0,
  );
  const [plannedSubs, setPlannedSubs] = useState<PlannedSubVM[]>(initialPlannedSubs);

  // Renombrado inline del nombre de la alineación (Bug BB).
  const currentLineupName = useMemo(
    () => lineups.find((l) => l.id === selectedLineupId)?.name ?? '',
    [lineups, selectedLineupId],
  );
  const [name, setName] = useState(currentLineupName);
  const [editingName, setEditingName] = useState(false);

  // Diálogo de motivo de descarte (drag banquillo/campo → Descartados).
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState<DiscardReason>('tecnico');

  // Form de cambio programado.
  const [subMinute, setSubMinute] = useState('');
  const [subOut, setSubOut] = useState('');
  const [subIn, setSubIn] = useState('');

  const formations = useMemo(() => formationsForFormat(format), [format]);
  const maxStarters = startersFor(format);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Bug BB — el server auto-crea el borrador ("Plan A" + primera formación), así
  // que el editor se abre directo. Este fallback solo aparece si la auto-creación
  // no fue posible (p.ej. sesión expirada).
  if (selectedLineupId == null) {
    return (
      <p
        className="rounded-lg border border-border p-4 text-sm text-muted-foreground"
        role="alert"
      >
        {t('prepare_failed')}
      </p>
    );
  }

  const lineupId = selectedLineupId;

  function saveName() {
    setEditingName(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentLineupName) {
      setName(currentLineupName);
      return;
    }
    startTransition(async () => {
      const r = await setLineupName({ lineup_id: lineupId, name: trimmed });
      if (r.error) {
        setName(currentLineupName);
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  }
  // F6.10 — la formación activa puede ser del catálogo o una plantilla del
  // entrenador (formation_code = uuid de coach_formations). Si es del coach,
  // sintetizamos un Formation con SU layout real (BUG 3). slotLabels traduce
  // el slot vacío por i18n (BUG 1): clave de posición (coach) o rol (catálogo).
  const activeCoachFormation: CoachFormation | null = getFormation(formationCode)
    ? null
    : (coachFormations.find((f) => f.id === formationCode) ?? null);
  const formation: Formation | undefined = activeCoachFormation
    ? coachFormationToFormation(activeCoachFormation)
    : getFormation(formationCode);
  const slotLabels: Record<string, string> = {};
  if (formation) {
    for (const s of formation.slots) {
      slotLabels[s.code] = activeCoachFormation
        ? tp(positionKeyOfSlotCode(s.code))
        : t(`pos_short.${ROLE_TO_SHORT[s.role]}`);
    }
  }

  const fieldPlayers: FieldEditorPlayer[] = positions
    .filter((p) => p.location === 'field')
    .map((p) => {
      const r = rosterById.get(p.playerId);
      return {
        playerId: p.playerId,
        label: shortLabel(r, p.playerId),
        dorsal: r?.dorsal ?? null,
        positionLabel: posLabelOf(p.playerId),
        photoUrl: r?.photoUrl ?? null,
        positionCode: p.positionCode,
        xPct: p.xPct,
        yPct: p.yPct,
      };
    });
  const benchPlayers = positions.filter((p) => p.location === 'bench');

  function reasonLabel(reason: string | null): string | null {
    if (!reason) return null;
    return (DISCARD_REASONS as readonly string[]).includes(reason)
      ? t(`out_reason.${reason as DiscardReason}`)
      : reason;
  }

  function persist(
    next: PositionAssignment[],
    changed: string[],
    prev: PositionAssignment[],
  ) {
    startTransition(async () => {
      setError(null);
      for (const pid of changed) {
        const a = next.find((x) => x.playerId === pid);
        if (!a) continue;
        const r = await upsertLineupPosition({
          lineup_id: lineupId,
          player_id: pid,
          location: a.location,
          position_code: a.positionCode,
          x_pct: a.xPct,
          y_pct: a.yPct,
        });
        if (r.error) {
          setPositions(prev);
          if (r.error === 'too_many_starters') {
            toast.error(t('field_full', { max: maxStarters }));
          } else {
            setError(r.error);
          }
          return;
        }
      }
    });
  }

  // Descartar (nivel evento): quita de positions, añade a Descartados, persiste
  // la decisión de convocatoria (que el server propaga a todas las alineaciones).
  function confirmDiscard(playerId: string, reason: DiscardReason) {
    const prevPos = positions;
    const prevDisc = discarded;
    setPositions(positions.filter((p) => p.playerId !== playerId));
    setDiscarded([...discarded, { playerId, reason }]);
    setPendingDiscard(null);
    startTransition(async () => {
      const r = await upsertCallupDecision({
        event_id: eventId,
        player_id: playerId,
        decision: 'discarded',
        reason,
      });
      if (r.error) {
        setPositions(prevPos);
        setDiscarded(prevDisc);
        setError(r.error);
      }
    });
  }

  // Reincluir: quita de Descartados y devuelve al banquillo (de todas las
  // alineaciones, vía la decisión called_up en el server).
  function reincludePlayer(playerId: string) {
    const prevPos = positions;
    const prevDisc = discarded;
    setDiscarded(discarded.filter((d) => d.playerId !== playerId));
    setPositions([
      ...positions,
      { playerId, location: 'bench', positionCode: null, xPct: null, yPct: null },
    ]);
    startTransition(async () => {
      const r = await upsertCallupDecision({
        event_id: eventId,
        player_id: playerId,
        decision: 'called_up',
        reason: null,
      });
      if (r.error) {
        setPositions(prevPos);
        setDiscarded(prevDisc);
        setError(r.error);
      }
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const playerId = parsePlayerDragId(activeId);
    if (!playerId || !overId) return;

    const isDiscarded = discardedIds.has(playerId);

    // Soltar en "Descartados" → pedir motivo (solo si venía de la alineación).
    if (overId === DISCARDED_ZONE_ID) {
      if (!isDiscarded) {
        setDiscardReason('tecnico');
        setPendingDiscard(playerId);
      }
      return;
    }

    // Un descartado soltado de nuevo en la alineación (banquillo o campo) →
    // reincluir al banquillo (luego el coach lo coloca en el campo si quiere).
    if (isDiscarded) {
      reincludePlayer(playerId);
      return;
    }

    // Movimiento normal campo/banquillo.
    const drop = resolveDrop(activeId, overId);
    if (!drop) return;
    const prev = positions;
    const { next, changed } = applyDrop(prev, drop, formation);
    if (changed.length === 0) return;

    if (
      drop.target.kind === 'field' &&
      exceedsStarters(next.filter((p) => p.location === 'field').length, format)
    ) {
      toast.error(t('field_full', { max: maxStarters }));
      return;
    }

    setPositions(next);
    persist(next, changed, prev);
  }

  // Fix #8 — seleccionar una formación aplica SOLO el layout (la geometría de
  // slots, que se deriva de `formationCode`): NO auto-rellena titulares. Todos
  // los jugadores quedan en el BANQUILLO y los slots del campo quedan VACÍOS para
  // que el coach los coloque a mano (arrastrar). Vale igual para una formación de
  // CATÁLOGO (code) y para una plantilla del entrenador (uuid de coach_formations):
  // en ambos casos el valor seleccionado ES el formation_code que se persiste.
  //
  // Antes: el catálogo (onFormationChange) recolocaba a los del campo vía
  // remapToFormation, y la plantilla del coach (onCoachFormationChange) mapeaba
  // jugadores a slots por orden y PERSISTÍA cada posición. Ahora ninguna lo hace.
  function applyFormationLayout(code: string) {
    const prev = positions;
    const prevCode = formationCode;
    // Todos al banquillo (sin posición); el campo queda con los slots vacíos.
    const optimistic = positions.map((p) =>
      p.location === 'field'
        ? { ...p, location: 'bench' as const, positionCode: null, xPct: null, yPct: null }
        : p,
    );
    // Solo hay que persistir a los que estaban en el campo (pasan a banquillo);
    // los que ya estaban en el banquillo no cambian.
    const changed = prev.filter((p) => p.location === 'field').map((p) => p.playerId);

    setPositions(optimistic);
    setFormationCode(code);
    startTransition(async () => {
      setError(null);
      const rf = await setLineupFormation({ lineup_id: lineupId, formation_code: code });
      if (rf.error) {
        setPositions(prev);
        setFormationCode(prevCode);
        setError(rf.error);
        return;
      }
      for (const pid of changed) {
        const r = await upsertLineupPosition({
          lineup_id: lineupId,
          player_id: pid,
          location: 'bench',
          position_code: null,
          x_pct: null,
          y_pct: null,
        });
        if (r.error) {
          setPositions(prev);
          setError(r.error);
          return;
        }
      }
    });
  }

  // Dispatcher del Select de formación: acepta tanto un code de catálogo como un
  // uuid de plantilla del coach; en ambos casos solo aplica el layout (geometría),
  // sin tocar jugadores. El value seleccionado es el formation_code a persistir.
  function onFormationSelect(value: string) {
    const isKnown =
      !!getFormation(value) || coachFormations.some((f) => f.id === value);
    if (isKnown) applyFormationLayout(value);
  }

  function onToggleOfficial(value: boolean) {
    startTransition(async () => {
      const r = await setLineupOfficial({ lineup_id: lineupId, is_official: value });
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  function onToggleVisibility(value: boolean) {
    const next = value ? 'team' : 'staff';
    setVisibility(next);
    startTransition(async () => {
      const r = await setLineupVisibility({ lineup_id: lineupId, visibility: next });
      if (r.error) {
        setVisibility(value ? 'staff' : 'team');
        setError(r.error);
      }
    });
  }

  function saveNotes() {
    startTransition(async () => {
      const r = await setTacticalNotes({ lineup_id: lineupId, notes: notes.trim() || null });
      if (r.error) setError(r.error);
      else toast.success(t('notes_saved'));
    });
  }

  function addPlannedSub() {
    const minute = Number(subMinute);
    if (!subOut || !subIn || subOut === subIn || !Number.isFinite(minute)) return;
    startTransition(async () => {
      const r = await createPlannedSub({
        lineup_id: lineupId,
        minute_planned: minute,
        player_out_id: subOut,
        player_in_id: subIn,
        position_code_target: null,
      });
      if (r.error || !r.subId) {
        setError(r.error ?? 'generic');
        return;
      }
      setPlannedSubs((prev) =>
        [
          ...prev,
          {
            id: r.subId!,
            minutePlanned: minute,
            playerOutId: subOut,
            playerInId: subIn,
            positionCodeTarget: null,
          },
        ].sort((a, b) => a.minutePlanned - b.minutePlanned),
      );
      setSubMinute('');
      setSubOut('');
      setSubIn('');
    });
  }

  function removePlannedSub(id: string) {
    setPlannedSubs((prev) => prev.filter((s) => s.id !== id));
    startTransition(async () => {
      const r = await deletePlannedSub({ id });
      if (r.error) setError(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controles superiores */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Nombre editable inline (Bug BB) */}
        {editingName ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') {
                setName(currentLineupName);
                setEditingName(false);
              }
            }}
            maxLength={60}
            className="h-8 w-40 font-semibold"
          />
        ) : (
          <Hint label={t('rename_hint')}>
            <button
              type="button"
              onClick={() => {
                setName(currentLineupName);
                setEditingName(true);
              }}
              className="rounded px-1.5 py-1 text-sm font-semibold hover:bg-muted"
            >
              {name || currentLineupName || t('name_label')}
            </button>
          </Hint>
        )}

        {lineups.length > 1 && (
          <Select value={lineupId} onValueChange={(id) => router.push(`${pathname}?lineup=${id}`)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lineups.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.isOfficial ? ` · ${t('official_badge')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('formation_label')}</span>
          <Hint label={t('formation_hint')}>
            <Select value={formationCode} onValueChange={onFormationSelect}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('formation_catalog')}</SelectLabel>
                  {formations.map((f) => (
                    <SelectItem key={f.code} value={f.code}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {coachFormations.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t('formation_mine')}</SelectLabel>
                    {coachFormations.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Hint>
        </div>

        <Hint label={t('official_hint')}>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={selectedIsOfficial} onCheckedChange={onToggleOfficial} disabled={pending} />
            {t('official_label')}
          </label>
        </Hint>

        <Hint label={t('share_hint')}>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={visibility === 'team'} onCheckedChange={onToggleVisibility} disabled={pending} />
            {t('share_label')}
          </label>
        </Hint>

        <Hint label={t('new_lineup_hint')}>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await createLineup({
                  event_id: eventId,
                  name: t('new_lineup_default_name'),
                  formation_code: defaultFormation(format).code,
                });
                if (r.error) {
                  setError(r.error);
                  return;
                }
                if (r.lineupId) router.push(`${pathname}?lineup=${r.lineupId}`);
              })
            }
          >
            <Plus className="size-4" aria-hidden />
            {t('new_lineup')}
          </Button>
        </Hint>

        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          {pending ? (
            <>
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {t('saving')}
            </>
          ) : (
            t('saved')
          )}
        </span>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="grid gap-3 lg:grid-cols-[1fr_2fr_1fr]">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t('bench')} · {benchPlayers.length}
            </h3>
            <DropZone id={BENCH_ZONE_ID}>
              {benchPlayers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('bench_empty')}</p>
              ) : (
                benchPlayers.map((p) => (
                  <PlayerPill
                    key={p.playerId}
                    playerId={p.playerId}
                    player={rosterById.get(p.playerId)}
                    positionLabel={posLabelOf(p.playerId)}
                  />
                ))
              )}
            </DropZone>
          </section>

          <section>
            <MatchFieldEditor
              format={format}
              formationCode={formationCode}
              formationOverride={formation}
              slotLabels={slotLabels}
              players={fieldPlayers}
              mode="edit"
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t('discarded_panel')} · {discarded.length}
            </h3>
            <DropZone id={DISCARDED_ZONE_ID}>
              {discarded.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('discarded_empty')}</p>
              ) : (
                discarded.map((d) => (
                  <PlayerPill
                    key={d.playerId}
                    playerId={d.playerId}
                    player={rosterById.get(d.playerId)}
                    positionLabel={posLabelOf(d.playerId)}
                    subLabel={reasonLabel(d.reason)}
                  />
                ))
              )}
            </DropZone>
            <p className="text-[10px] text-muted-foreground">
              {t('discarded_hint')}
            </p>
          </section>
        </div>
      </DndContext>

      {/* Cambios programados (F6.8) */}
      <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">
          {t('planned_subs')} · {plannedSubs.length}
        </h3>
        {plannedSubs.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {plannedSubs.map((s) => {
              const out = rosterById.get(s.playerOutId);
              const inn = rosterById.get(s.playerInId);
              return (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span>
                    {t('sub_line', {
                      minute: s.minutePlanned,
                      out: shortLabel(out, s.playerOutId),
                      in: shortLabel(inn, s.playerInId),
                    })}
                  </span>
                  <Hint label={t('sub_remove_hint')}>
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('remove')} onClick={() => removePlannedSub(s.id)}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </Hint>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground">{t('sub_minute')}</label>
            <Input className="h-8 w-16" type="number" min={0} max={120} value={subMinute} onChange={(e) => setSubMinute(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground">{t('sub_out')}</label>
            <Select value={subOut} onValueChange={setSubOut}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {positions.map((p) => (
                  <SelectItem key={p.playerId} value={p.playerId}>
                    {shortLabel(rosterById.get(p.playerId), p.playerId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground">{t('sub_in')}</label>
            <Select value={subIn} onValueChange={setSubIn}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {benchPlayers.map((p) => (
                  <SelectItem key={p.playerId} value={p.playerId}>
                    {shortLabel(rosterById.get(p.playerId), p.playerId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" size="sm" disabled={pending || !subOut || !subIn || subOut === subIn || subMinute === ''} onClick={addPlannedSub}>
            <Plus className="size-4" aria-hidden />
            {t('sub_add')}
          </Button>
        </div>
      </section>

      {/* Notas tácticas (F6.9) — solo staff */}
      <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <button type="button" className="flex items-center justify-between text-sm font-semibold" onClick={() => setShowNotes((v) => !v)}>
          <span>{t('tactical_notes')}</span>
          <span className="text-xs text-muted-foreground">{showNotes ? '−' : '+'}</span>
        </button>
        {showNotes && (
          <div className="flex flex-col gap-2">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={4} placeholder={t('tactical_notes_placeholder')} />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{t('tactical_notes_staff_only')}</span>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={saveNotes}>
                {t('save_notes')}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Diálogo motivo de descarte */}
      <Dialog open={pendingDiscard != null} onOpenChange={(o) => !o && setPendingDiscard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('discard_reason_title')}</DialogTitle>
            <DialogDescription>{t('discard_reason_body')}</DialogDescription>
          </DialogHeader>
          <Select value={discardReason} onValueChange={(v) => setDiscardReason(v as DiscardReason)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DISCARD_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`out_reason.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDiscard(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (pendingDiscard) confirmDiscard(pendingDiscard, discardReason);
              }}
            >
              {t('discard_confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
