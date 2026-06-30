'use client';

/**
 * F13.2 — Editor de jugada: cabecera + <PitchBoard> del FRAME ACTIVO + timeline de
 * frames (añadir / duplicar / borrar / reordenar dnd / seleccionar activo).
 *
 * Estado: la jugada vive aquí. Los frames se llevan como `items` con un `id` de
 * CLIENTE estable (necesario para dnd-kit y para el remount por `key`); ese id NO
 * se persiste (el contrato 13.1a es posicional: `frames[]` sin id). Los ids
 * iniciales son deterministas (`f0..fn-1`) para no provocar un hydration mismatch;
 * los nuevos salen de un contador (solo en handlers de cliente).
 *
 * Cambiar de frame activo REMONTA el <PitchEditor> con `key={activeId}` (patrón
 * pizarra) sembrándolo con la escena de ese frame; `onChange` (memoizado, ver nota)
 * eleva las ediciones al frame activo y mantiene el `field` común. Reordenar NO
 * remonta el board (el activo no cambia). Guardar valida con `parsePlay`.
 *
 * Duplicar: copia la escena del frame activo CONSERVANDO los ids de elemento, e
 * inserta el duplicado JUSTO DESPUÉS. Así `sceneAtTime` casa por id entre el frame
 * y su duplicado-luego-editado → un jugador duplicado y movido se ANIMA de A a B.
 * La unicidad de ids es POR frame (validación 13.1a), así que repetir ids entre
 * frames es válido y es justo lo que la animación necesita.
 */

import { useCallback, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Plus,
  Copy,
  Trash2,
  Save,
  Send,
  GripVertical,
  Play as PlayIcon,
  Pause as PauseIcon,
  Square as StopIcon,
  Repeat as RepeatIcon,
} from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DIAGRAM_VERSION,
  PLAY_VERSION,
  MAX_FRAMES,
  MIN_FRAME_MS,
  MAX_FRAME_MS,
  DEFAULT_FRAME_MS,
  STRATEGY_TYPES,
  type Diagram,
  type DiagramField,
  type Play,
  type PlayFrame,
  type StrategyType,
} from '@misterfc/core';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PitchEditor } from '@/components/match/pitch-editor';
import { DiagramView } from '@/components/match/diagram-view';
import type { PlayForEdit } from '../queries';
import { updatePlay, proposePlayChanges } from '../actions';
import { usePlayback, PLAYBACK_SPEEDS } from './use-playback';
import { PlayDeleteButton } from './play-delete-button';
import { PlayCycleActions } from './play-cycle-actions';
import { PlaybackFullscreen } from './playback-fullscreen';

// Estado → variante visual del badge (la etiqueta se localiza por i18n).
const STATUS_VARIANT: Record<
  PlayForEdit['status'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  published: 'default',
  proposed: 'secondary',
  draft: 'outline',
  rejected: 'destructive',
};

/** ms → "1,2 s" para la lectura de tiempo de la barra de reproducción. */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Frame + id de cliente (estable para dnd/remount; NO se persiste). */
type FrameItem = { id: string; frame: PlayFrame };

function frameToDiagram(field: DiagramField, frame: PlayFrame): Diagram {
  return { version: DIAGRAM_VERSION, field, elements: frame.elements };
}

/** Chip de la timeline: asa de arrastre (reordenar) + botón de selección. */
function SortableFrameChip({
  id,
  label,
  active,
  reorderLabel,
  onSelect,
}: {
  id: string;
  label: string;
  active: boolean;
  reorderLabel: string;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className={cn(
        'flex items-center gap-1 rounded-md border py-1 pl-1 pr-2 text-sm transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none opacity-70 hover:opacity-100"
        aria-label={reorderLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <button type="button" onClick={onSelect} aria-pressed={active}>
        {label}
      </button>
    </div>
  );
}

export function PlayEditor({
  play: initial,
  canDelete = false,
  canEdit = false,
  canPropose = false,
  isOwner = false,
  isApprover = false,
}: {
  play: PlayForEdit;
  canDelete?: boolean;
  /** ¿Puede editar el CONTENIDO? (autor de no-publicada ∪ aprobador). Si no, solo lectura. */
  canEdit?: boolean;
  /** ¿Puede PROPONER cambios? (no-aprobador con autoría sobre una jugada publicada).
   *  Edita el formulario en local y al guardar crea una COPIA 'proposed' (no toca la
   *  original). Excluyente con canEdit. */
  canPropose?: boolean;
  isOwner?: boolean;
  isApprover?: boolean;
}) {
  const t = useTranslations('jugadas');
  const tStatus = useTranslations('jugadas.status');
  const tStrategy = useTranslations('jugadas.strategy');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // El diseño de una jugada PUBLICADA solo lo edita en sitio un aprobador (ciclo de
  // aprobación, JR-0). Para el resto es solo lectura → en vez de un genérico "Solo
  // lectura" mudo, explicamos el motivo (hace falta aprobación del coordinador). No
  // cambia el permiso (la página ya pone canEdit=false); solo aclara la experiencia.
  const designLocked = !canEdit && initial.status === 'published';
  // En modo "proponer cambios" el formulario SÍ es editable en local (los cambios no
  // se guardan en la original: al enviar crean una copia 'proposed'). Si no, la
  // editabilidad del formulario = canEdit.
  const formEditable = canEdit || canPropose;

  // Cabecera editable (name/description). El estado/ciclo se gestiona aparte.
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  // Jugada de estrategia: el TIPO es de la jugada (obligatorio al guardar). '' = sin
  // elegir (jugadas previas vienen NULL → fuerzan a completarlo al editar). La SEÑA
  // NO va aquí: es por equipo y se elige en el playbook del equipo (team_plays).
  const [strategyType, setStrategyType] = useState<StrategyType | ''>(
    initial.strategy_type ?? '',
  );

  // Jugada: field común + frames con id de cliente. Ids iniciales deterministas.
  const [field, setField] = useState<DiagramField>(initial.play.field);
  const [items, setItems] = useState<FrameItem[]>(() =>
    initial.play.frames.map((frame, i) => ({ id: `f${i}`, frame })),
  );
  const [activeId, setActiveId] = useState('f0');
  // Contador para ids nuevos (solo se usa en handlers de cliente).
  const idCounter = useRef(initial.play.frames.length);
  const nextId = () => `f${idCounter.current++}`;

  // dnd-kit inyecta atributos en el render que difieren entre SSR y cliente
  // (limitación conocida de SSR): activamos el sortable SOLO en cliente para no
  // provocar un hydration mismatch. `useSyncExternalStore` da false en SSR y en
  // el primer paint (coincide con el HTML), y true tras hidratar — sin setState
  // en efecto. El SSR/primer paint pinta chips planos seleccionables.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeItem = items.find((it) => it.id === activeId) ?? items[0]!;

  // Reproducción (F13.3): interpola la jugada ACTUAL (frames editados en vivo).
  const currentPlay: Play = { version: PLAY_VERSION, field, frames: items.map((it) => it.frame) };

  // ¿Hay cambios respecto a la jugada cargada? (para habilitar "Proponer cambios":
  // no tiene sentido proponer una copia idéntica). Compara cabecera + tipo + diseño.
  const dirty =
    name !== (initial.name ?? '') ||
    description !== (initial.description ?? '') ||
    strategyType !== (initial.strategy_type ?? '') ||
    JSON.stringify({ field, frames: currentPlay.frames }) !==
      JSON.stringify({ field: initial.play.field, frames: initial.play.frames });
  const {
    scene,
    playing,
    previewing,
    t: tNow,
    total,
    canAnimate,
    loop,
    speed,
    toggle: togglePlayback,
    stop: stopPlayback,
    seek,
    setLoop,
    setSpeed,
  } = usePlayback(currentPlay);

  /**
   * Eleva la escena editada al frame activo (y sincroniza el field común).
   * MEMOIZADO: <PitchEditor> tiene un efecto `onChange` con deps `[state, onChange]`;
   * una identidad nueva por render dispararía un bucle de re-render ("Maximum update
   * depth exceeded"). Solo depende de `activeId` (y al cambiarlo el editor se remonta
   * por `key`, así que es estable).
   */
  const onFrameChange = useCallback(
    (d: Diagram) => {
      setField(d.field);
      setItems((prev) =>
        prev.map((it) => (it.id === activeId ? { ...it, frame: { ...it.frame, elements: d.elements } } : it)),
      );
    },
    [activeId],
  );

  function addFrameAt() {
    if (items.length >= MAX_FRAMES) {
      toast.error(t('frames.max', { max: MAX_FRAMES }));
      return;
    }
    const id = nextId();
    setItems((prev) => [...prev, { id, frame: { elements: [] } }]);
    setActiveId(id);
  }

  /** Duplica el frame activo JUSTO DESPUÉS, conservando los ids de elemento. */
  function duplicateActive() {
    if (items.length >= MAX_FRAMES) {
      toast.error(t('frames.max', { max: MAX_FRAMES }));
      return;
    }
    const idx = items.findIndex((it) => it.id === activeId);
    if (idx < 0) return;
    const src = items[idx]!.frame;
    // Copia la escena MANTENIENDO los ids (clave para que la animación interpole).
    // Copiamos el array; los elementos no se mutan in situ (las ediciones los
    // reemplazan), así que compartir su referencia es seguro.
    const copy: PlayFrame =
      src.duration_ms != null
        ? { elements: [...src.elements], duration_ms: src.duration_ms }
        : { elements: [...src.elements] };
    const id = nextId();
    setItems((prev) => [...prev.slice(0, idx + 1), { id, frame: copy }, ...prev.slice(idx + 1)]);
    setActiveId(id);
  }

  function removeActive() {
    if (items.length <= 1) return; // la jugada tiene >= 1 frame
    const idx = items.findIndex((it) => it.id === activeId);
    if (idx < 0) return;
    const remaining = items.filter((it) => it.id !== activeId);
    const next = remaining[idx > 0 ? idx - 1 : 0] ?? remaining[0]!;
    setItems(remaining);
    setActiveId(next.id);
  }

  function setActiveDuration(value: string) {
    const n = value.trim() === '' ? undefined : Number.parseInt(value, 10);
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== activeId) return it;
        // Vacío/NaN → sin duration_ms (vuelve al default global DEFAULT_FRAME_MS).
        if (n == null || Number.isNaN(n)) return { ...it, frame: { elements: it.frame.elements } };
        return { ...it, frame: { ...it.frame, duration_ms: n } };
      }),
    );
  }

  function onDragEnd(e: DragEndEvent) {
    const { active: a, over } = e;
    if (!over || a.id === over.id) return;
    const from = items.findIndex((it) => it.id === a.id);
    const to = items.findIndex((it) => it.id === over.id);
    if (from < 0 || to < 0) return;
    setItems((prev) => arrayMove(prev, from, to)); // el frame activo no cambia
  }

  function save() {
    // El tipo de estrategia es obligatorio (jugada de estrategia). Aviso claro antes
    // de llamar a la action (que también lo valida con zod). La seña no va aquí.
    if (strategyType === '') {
      toast.error(t('errors.strategy_required'));
      return;
    }
    const playload: Play = { version: PLAY_VERSION, field, frames: items.map((it) => it.frame) };
    startTransition(async () => {
      const res = await updatePlay({
        id: initial.id,
        name: name.trim() === '' ? null : name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        play: playload,
        strategy_type: strategyType,
      });
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(t('toast.saved'));
      router.refresh();
    });
  }

  /**
   * "Proponer cambios" sobre una jugada PUBLICADA: crea una COPIA 'proposed' con los
   * cambios del proponente (la original no se toca) y lleva al editor de la copia,
   * que ya entra en la cola de revisión del coordinador.
   */
  function propose() {
    if (strategyType === '') {
      toast.error(t('errors.strategy_required'));
      return;
    }
    const playload: Play = { version: PLAY_VERSION, field, frames: items.map((it) => it.frame) };
    startTransition(async () => {
      const res = await proposePlayChanges({
        id: initial.id,
        name: name.trim() === '' ? null : name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        play: playload,
        strategy_type: strategyType,
      });
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(t('toast.proposed'));
      if (res.id) router.push(`/jugadas/${res.id}/editar`);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Estado + acciones de ciclo (JR-1) ──────────────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <Badge
          variant={initial.archived ? 'outline' : STATUS_VARIANT[initial.status]}
          className="text-[10px] uppercase tracking-wider"
        >
          {initial.archived ? tStatus('archived') : tStatus(initial.status)}
        </Badge>
        <PlayCycleActions
          id={initial.id}
          status={initial.status}
          archived={initial.archived}
          isOwner={isOwner}
          isApprover={isApprover}
          sourcePlayId={initial.source_play_id}
          sourceName={initial.source_name}
        />
      </section>

      {/* Aviso de rechazo: el autor ve el motivo para corregir y reproponer. */}
      {initial.status === 'rejected' && initial.rejection_reason ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium">{t('detail.rejected_reason')}</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {initial.rejection_reason}
          </p>
        </div>
      ) : null}

      {/* Nota de publicación (aprobada): por quién y cuándo. */}
      {initial.status === 'published' && initial.approved_at ? (
        <p className="text-sm text-muted-foreground">
          {initial.approved_by_name
            ? t('detail.approved_by_at', {
                name: initial.approved_by_name,
                date: new Date(initial.approved_at).toLocaleDateString(),
              })
            : t('detail.published_note')}
        </p>
      ) : null}

      {/* Nota de propuesta: esta jugada nació como "proponer cambios" sobre otra. */}
      {initial.source_play_id ? (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          <p className="font-medium">{t('detail.proposal_title')}</p>
          <p className="mt-1 text-muted-foreground">
            {initial.source_name
              ? t('detail.proposal_of_named', { name: initial.source_name })
              : t('detail.proposal_of')}
          </p>
        </div>
      ) : null}

      {/* Diseño bloqueado: un no-aprobador no puede editar en sitio una jugada
          publicada. Si ADEMÁS puede crear jugadas → le ofrecemos PROPONER cambios
          (banner con instrucción); si no, el aviso de solo lectura de #242. */}
      {canPropose ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{t('detail.propose_title')}</p>
          <p className="mt-1 text-muted-foreground">{t('detail.propose_note')}</p>
        </div>
      ) : designLocked ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{t('detail.design_locked_title')}</p>
          <p className="mt-1 text-muted-foreground">{t('detail.design_locked_note')}</p>
        </div>
      ) : null}

      {/* ── Cabecera ───────────────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="play-name">{t('fields.name')}</Label>
          <Input
            id="play-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('fields.name_ph')}
            maxLength={120}
            disabled={!formEditable}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="play-description">{t('fields.description')}</Label>
          <Textarea
            id="play-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('fields.description_ph')}
            rows={2}
            disabled={!formEditable}
          />
        </div>
      </section>

      {/* ── Estrategia: tipo (obligatorio) ─────────────────────────────────── */}
      {/* La seña NO va aquí: es por equipo y se elige en el playbook del equipo. */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="play-strategy">
            {t('fields.strategy_type')} <span className="text-destructive">*</span>
          </Label>
          <Select
            value={strategyType || undefined}
            onValueChange={(v) => setStrategyType(v as StrategyType)}
            disabled={!formEditable}
          >
            <SelectTrigger id="play-strategy">
              <SelectValue placeholder={t('fields.strategy_type_ph')} />
            </SelectTrigger>
            <SelectContent>
              {STRATEGY_TYPES.map((st) => (
                <SelectItem key={st} value={st}>
                  {tStrategy(st)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* ── Timeline de frames ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t('frames.title')}</h2>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={duplicateActive}
              disabled={pending}
            >
              <Copy className="size-4" aria-hidden />
              {t('frames.duplicate')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={addFrameAt} disabled={pending}>
              <Plus className="size-4" aria-hidden />
              {t('frames.add')}
            </Button>
          </div>
        </div>

        {/* Reordenar arrastrando el asa de cada chip (= orden de la animación).
            Solo tras montar en cliente (ver `mounted`); en SSR/primer paint, chips
            planos seleccionables idénticos en layout → sin hydration mismatch. */}
        {mounted ? (
          <DndContext
            id="play-frames-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={items.map((it) => it.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex flex-wrap items-center gap-2">
                {items.map((it, i) => (
                  <SortableFrameChip
                    key={it.id}
                    id={it.id}
                    label={t('frames.frame', { n: i + 1 })}
                    active={it.id === activeId}
                    reorderLabel={t('frames.reorder')}
                    onSelect={() => setActiveId(it.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setActiveId(it.id)}
                aria-pressed={it.id === activeId}
                className={cn(
                  'rounded-md border px-3 py-1 text-sm transition-colors',
                  it.id === activeId
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {t('frames.frame', { n: i + 1 })}
              </button>
            ))}
          </div>
        )}

        {/* Controles del frame activo: duración de transición + borrar. */}
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="frame-duration">{t('frames.duration')}</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="frame-duration"
                type="number"
                className="w-28"
                min={MIN_FRAME_MS}
                max={MAX_FRAME_MS}
                step={100}
                value={activeItem.frame.duration_ms ?? ''}
                placeholder={String(DEFAULT_FRAME_MS)}
                onChange={(e) => setActiveDuration(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">{t('frames.duration_ms')}</span>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={removeActive}
            disabled={items.length <= 1 || pending}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('frames.remove')}
          </Button>
        </div>
      </section>

      {/* ── Reproducción (F13.3/F13.4) + board del frame activo ─────────────── */}
      <section className="flex flex-col gap-3">
        {/* Barra de reproducción: SIEMPRE visible mientras se edita la jugada.
            Con < 2 frames no hay nada que animar (duración 0) → el Play queda
            visible pero DESHABILITADO, con tooltip + texto inline (no oculto). */}
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium">{t('playback.title')}</h2>
          {canAnimate ? (
            <>
              <Button type="button" size="sm" onClick={togglePlayback}>
                {playing ? (
                  <>
                    <PauseIcon className="size-4" aria-hidden />
                    {t('playback.pause')}
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-4" aria-hidden />
                    {t('playback.play')}
                  </>
                )}
              </Button>
              <Hint label={t('playback.stop')}>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={stopPlayback}
                  disabled={!previewing}
                  aria-label={t('playback.stop')}
                >
                  <StopIcon className="size-4" aria-hidden />
                </Button>
              </Hint>
              {/* LOOP (toggle): activo = variante sólida. */}
              <Hint label={t('playback.loop')}>
                <Button
                  type="button"
                  size="icon"
                  variant={loop ? 'default' : 'outline'}
                  onClick={() => setLoop(!loop)}
                  aria-pressed={loop}
                  aria-label={t('playback.loop')}
                >
                  <RepeatIcon className="size-4" aria-hidden />
                </Button>
              </Hint>
              {/* VELOCIDAD: multiplicador del avance de t. */}
              <div
                className="inline-flex items-center gap-1"
                role="group"
                aria-label={t('playback.speed')}
              >
                {PLAYBACK_SPEEDS.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={speed === s ? 'default' : 'outline'}
                    onClick={() => setSpeed(s)}
                    aria-pressed={speed === s}
                  >
                    {t('playback.speed_x', { x: s })}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <Hint label={t('playback.need_frames')}>
              {/* Botón deshabilitado no emite eventos → el span es el trigger del
                  tooltip (focusable en táctil/teclado). */}
              <span tabIndex={0} className="inline-flex">
                <Button type="button" size="sm" disabled aria-disabled>
                  <PlayIcon className="size-4" aria-hidden />
                  {t('playback.play')}
                </Button>
              </span>
            </Hint>
          )}
          {/* Pantalla completa (presentación read-only; adelanta parte de 13.7). */}
          <PlaybackFullscreen play={currentPlay} />
        </div>

        {/* SCRUB: barra para moverse por la animación + lectura de tiempo. */}
        {canAnimate ? (
          <div className="flex items-center gap-3">
            <Slider
              aria-label={t('playback.scrub')}
              min={0}
              max={total}
              step={10}
              value={[tNow]}
              onValueChange={([v]) => seek(v ?? 0)}
              className="max-w-md"
            />
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
              {formatSeconds(tNow)} / {formatSeconds(total)}
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{t('playback.need_frames')}</span>
        )}

        {previewing ? (
          // Reproducción read-only: <DiagramView> honra la opacidad (fade) de la Scene.
          <DiagramView diagram={scene} />
        ) : (
          <PitchEditor
            key={activeId}
            initialDiagram={frameToDiagram(field, activeItem.frame)}
            onChange={onFrameChange}
            showClear
          />
        )}
      </section>

      {/* ── Borrar (F13.4) + Guardar ───────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        {canDelete ? (
          <PlayDeleteButton
            playId={initial.id}
            playName={name.trim() === '' ? null : name.trim()}
            redirectToList
          />
        ) : (
          <span />
        )}
        {canEdit ? (
          <Button type="button" onClick={save} disabled={pending}>
            <Save className="size-4" aria-hidden />
            {t('save')}
          </Button>
        ) : canPropose ? (
          // Proponer cambios: deshabilitado hasta que haya cambios (no proponer una
          // copia idéntica). El tooltip explica el requisito cuando está inhabilitado.
          <Hint label={dirty ? t('propose.hint') : t('propose.need_changes')}>
            <span tabIndex={0} className="inline-flex">
              <Button type="button" onClick={propose} disabled={pending || !dirty}>
                <Send className="size-4" aria-hidden />
                {t('propose.button')}
              </Button>
            </span>
          </Hint>
        ) : (
          <span className="text-sm text-muted-foreground">
            {designLocked ? t('detail.design_locked_short') : t('read_only')}
          </span>
        )}
      </div>
    </div>
  );
}
