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
import { Plus, Copy, Trash2, Save, GripVertical } from 'lucide-react';
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
  type Diagram,
  type DiagramField,
  type Play,
  type PlayFrame,
} from '@misterfc/core';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PitchEditor } from '@/components/match/pitch-editor';
import type { PlayForEdit, PlayVisibility } from '../queries';
import { updatePlay } from '../actions';

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

export function PlayEditor({ play: initial }: { play: PlayForEdit }) {
  const t = useTranslations('jugadas');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Cabecera editable (el equipo es inmutable → solo se muestra).
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [visibility, setVisibility] = useState<PlayVisibility>(initial.visibility);

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
    const playload: Play = { version: PLAY_VERSION, field, frames: items.map((it) => it.frame) };
    startTransition(async () => {
      const res = await updatePlay({
        id: initial.id,
        name: name.trim() === '' ? null : name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        visibility,
        play: playload,
      });
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(t('toast.saved'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
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
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('fields.team')}</Label>
          {/* El equipo es inmutable tras crear (trigger 13.1b) → solo lectura. */}
          <Input value={initial.team_name ?? '—'} disabled readOnly />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="play-visibility">{t('fields.visibility')}</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as PlayVisibility)}>
            <SelectTrigger id="play-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">{t('visibility.staff')}</SelectItem>
              <SelectItem value="team">{t('visibility.team')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="play-description">{t('fields.description')}</Label>
          <Textarea
            id="play-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('fields.description_ph')}
            rows={2}
          />
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

      {/* ── Board del frame activo ─────────────────────────────────────────── */}
      <section>
        <PitchEditor
          key={activeId}
          initialDiagram={frameToDiagram(field, activeItem.frame)}
          onChange={onFrameChange}
          showClear
        />
      </section>

      {/* ── Guardar ────────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={pending}>
          <Save className="size-4" aria-hidden />
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
