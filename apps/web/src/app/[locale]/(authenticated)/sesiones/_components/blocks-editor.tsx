'use client';

/**
 * F12.2b — Editor de BLOQUES: añadir ejercicios (picker filtrado), editar overrides
 * del día inline, quitar tareas y REORDENAR bloques, reordenar tareas dentro de un
 * bloque y MOVER tareas ENTRE bloques con dnd-kit (un único DndContext
 * multi-contenedor; ratón + táctil + teclado). total_minutes = suma de duration_min
 * (derivado; aquí en vivo con sumTaskMinutes, el trigger lo persiste).
 *
 * Estado local de `blocks` como fuente durante la edición: las mutaciones llaman a
 * las server actions (RLS = gate) y actualizan el estado; el drag es optimista y
 * persiste en segundo plano (revierte con refresh si falla).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, ExternalLink, GripVertical, X } from 'lucide-react';
import { sumTaskMinutes } from '@misterfc/core';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link, useRouter } from '@/i18n/navigation';
import { ExercisePicker } from './exercise-picker';
import { PlayPicker } from './play-picker';
import {
  addBlockTask,
  updateBlockTask,
  removeBlockTask,
  reorderBlocks,
  reorderTasks,
  moveTask,
  addPlayToBlock,
  updateBlockPlay,
  removePlayFromBlock,
  reorderBlockPlays,
} from '../actions';
import type {
  SessionForEdit,
  SessionBlockForEdit,
  SessionTaskForEdit,
  SessionBlockPlayForEdit,
  PickableExercise,
  AddableSessionPlay,
} from '../queries';

// ── Fila de tarea (override del día editable + drag handle + quitar) ──────────
function TaskRow({
  task,
  onUpdate,
  onRemove,
}: {
  task: SessionTaskForEdit;
  onUpdate: (id: string, patch: { duration_min: string; series: string; notes: string }) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations('sesiones.blocks');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const [duration, setDuration] = useState(
    task.duration_min != null ? String(task.duration_min) : ''
  );
  const [series, setSeries] = useState(task.series ?? '');
  const [notes, setNotes] = useState(task.notes ?? '');

  function persist() {
    onUpdate(task.id, { duration_min: duration, series, notes });
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2"
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        aria-label={t('reorder_task')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm">{task.exercise_name}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={600}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        onBlur={persist}
        placeholder={t('duration_ph')}
        className="w-16"
        aria-label={t('duration')}
      />
      <Input
        value={series}
        onChange={(e) => setSeries(e.target.value)}
        onBlur={persist}
        placeholder={t('series_ph')}
        maxLength={60}
        className="w-24"
        aria-label={t('series')}
      />
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={persist}
        placeholder={t('notes_ph')}
        maxLength={2000}
        className="w-32"
        aria-label={t('notes')}
      />
      <button
        type="button"
        onClick={() => onRemove(task.id)}
        aria-label={t('remove')}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

// ── Fila de jugada (sub-lista "Jugadas a entrenar", D3): override del día + abrir
//    visor/editor + subir/bajar + quitar. No es drag (lista separada de las tareas).
function PlayRow({
  play,
  isFirst,
  isLast,
  onUpdate,
  onMove,
  onRemove,
}: {
  play: SessionBlockPlayForEdit;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (id: string, patch: { duration_min: string; notes: string }) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations('sesiones.blocks');
  const [duration, setDuration] = useState(
    play.duration_min != null ? String(play.duration_min) : ''
  );
  const [notes, setNotes] = useState(play.notes ?? '');

  function persist() {
    onUpdate(play.id, { duration_min: duration, notes });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => onMove(play.id, -1)}
          disabled={isFirst}
          aria-label={t('move_up')}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onMove(play.id, 1)}
          disabled={isLast}
          aria-label={t('move_down')}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </div>
      <span className="min-w-0 flex-1 truncate text-sm">
        {play.play_name || t('play_untitled')}
      </span>
      <Badge variant="outline" className="shrink-0 text-xs font-normal">
        {t('frame_count', { count: play.frame_count })}
      </Badge>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={600}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        onBlur={persist}
        placeholder={t('duration_ph')}
        className="w-16"
        aria-label={t('duration')}
      />
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={persist}
        placeholder={t('notes_ph')}
        maxLength={2000}
        className="w-32"
        aria-label={t('notes')}
      />
      <Link
        href={`/jugadas/${play.play_id}/editar`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('open_play')}
        className="text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="size-4" aria-hidden />
      </Link>
      <button
        type="button"
        onClick={() => onRemove(play.id)}
        aria-label={t('remove_play')}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

// ── Bloque sortable (cabecera con handle + tareas sortables + picker) ─────────
// El DndContext es ÚNICO (vive en BlocksEditor): aquí solo se declara el
// SortableContext de las tareas del bloque y el bloque como item sortable/droppable.
function SortableBlock({
  block,
  blockLabel,
  pickable,
  addablePlays,
  hasTeam,
  defaultCategory,
  defaultTactical,
  defaultTechnical,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onAddPlay,
  onUpdatePlay,
  onMovePlay,
  onRemovePlay,
  pending,
}: {
  block: SessionBlockForEdit;
  blockLabel: string;
  pickable: PickableExercise[];
  addablePlays: AddableSessionPlay[];
  hasTeam: boolean;
  defaultCategory: string | null;
  defaultTactical: string[];
  defaultTechnical: string[];
  onAddTask: (blockId: string, exerciseId: string, name: string) => void;
  onUpdateTask: (blockId: string, taskId: string, patch: { duration_min: string; series: string; notes: string }) => void;
  onRemoveTask: (blockId: string, taskId: string) => void;
  onAddPlay: (blockId: string, playId: string, name: string) => void;
  onUpdatePlay: (blockId: string, playRowId: string, patch: { duration_min: string; notes: string }) => void;
  onMovePlay: (blockId: string, playRowId: string, dir: -1 | 1) => void;
  onRemovePlay: (blockId: string, playRowId: string) => void;
  pending: boolean;
}) {
  const t = useTranslations('sesiones.blocks');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          aria-label={t('reorder_block')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <Badge variant="secondary">{blockLabel}</Badge>
        {block.title ? <span className="text-sm font-medium">{block.title}</span> : null}
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {/* Ejercicios primero */}
        <SortableContext items={block.tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          {block.tasks.length === 0 ? (
            <p className="rounded-md border border-dashed py-3 text-center text-xs text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {block.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onUpdate={(id, patch) => onUpdateTask(block.id, id, patch)}
                  onRemove={(id) => onRemoveTask(block.id, id)}
                />
              ))}
            </ul>
          )}
        </SortableContext>

        {/* Jugadas a entrenar (D3): sub-lista discreta debajo, solo si hay */}
        {block.plays.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('plays_heading')}
            </p>
            <ul className="flex flex-col gap-1.5">
              {block.plays.map((play, i) => (
                <PlayRow
                  key={play.id}
                  play={play}
                  isFirst={i === 0}
                  isLast={i === block.plays.length - 1}
                  onUpdate={(id, patch) => onUpdatePlay(block.id, id, patch)}
                  onMove={(id, dir) => onMovePlay(block.id, id, dir)}
                  onRemove={(id) => onRemovePlay(block.id, id)}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Pickers juntos: añadir ejercicio + añadir jugada, lado a lado */}
        <div className="flex flex-wrap gap-2">
          <ExercisePicker
            exercises={pickable}
            phase={block.block_type}
            defaultCategory={defaultCategory}
            defaultTactical={defaultTactical}
            defaultTechnical={defaultTechnical}
            onPick={(id, name) => onAddTask(block.id, id, name)}
            disabled={pending}
          />
          <PlayPicker
            plays={addablePlays}
            excludeIds={block.plays.map((p) => p.play_id)}
            hasTeam={hasTeam}
            onPick={(id, name) => onAddPlay(block.id, id, name)}
            disabled={pending}
          />
        </div>
      </div>
    </div>
  );
}

// ── Editor de bloques (estado + mutaciones + dnd multi-contenedor) ────────────
export function BlocksEditor({
  session,
  pickable,
  addablePlays,
}: {
  session: SessionForEdit;
  pickable: PickableExercise[];
  addablePlays: AddableSessionPlay[];
}) {
  const t = useTranslations('sesiones');
  const tBlocks = useTranslations('sesiones.block_types');
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [blocks, setBlocks] = useState<SessionBlockForEdit[]>(session.blocks);
  const [pending, startTransition] = useTransition();

  const hasTeam = session.team_id != null;

  // D8 — total = duración de ejercicios ∪ jugadas (la BD lo persiste igual).
  const total = sumTaskMinutes([
    ...blocks.flatMap((b) => b.tasks.map((x) => x.duration_min)),
    ...blocks.flatMap((b) => b.plays.map((x) => x.duration_min)),
  ]);

  function fail(err: string | undefined) {
    toast.error(t(`errors.${err ?? 'generic'}`));
    router.refresh();
  }

  const isBlockId = (id: string) => blocks.some((b) => b.id === id);
  const blockOfTask = (taskId: string) => blocks.find((b) => b.tasks.some((x) => x.id === taskId));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // ── Reordenar BLOQUES ──
    if (isBlockId(activeId)) {
      if (activeId === overId || !isBlockId(overId)) return;
      const ids = blocks.map((b) => b.id);
      const from = ids.indexOf(activeId);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0) return;
      const next = arrayMove(blocks, from, to);
      setBlocks(next);
      startTransition(async () => {
        const res = await reorderBlocks({ session_id: session.id, block_ids: next.map((b) => b.id) });
        if (res.error) fail(res.error);
      });
      return;
    }

    // ── Tareas ──
    const fromBlock = blockOfTask(activeId);
    if (!fromBlock) return;
    const toBlockId = isBlockId(overId) ? overId : blockOfTask(overId)?.id;
    if (!toBlockId) return;
    const toBlock = blocks.find((b) => b.id === toBlockId)!;

    if (fromBlock.id === toBlockId) {
      // Reordenar dentro del bloque.
      if (activeId === overId) return;
      const ids = fromBlock.tasks.map((x) => x.id);
      const from = ids.indexOf(activeId);
      const to = isBlockId(overId) ? ids.length - 1 : ids.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      const newIds = arrayMove(ids, from, to);
      setBlocks((prev) =>
        prev.map((b) =>
          b.id !== fromBlock.id ? b : { ...b, tasks: newIds.map((id) => b.tasks.find((x) => x.id === id)!) }
        )
      );
      startTransition(async () => {
        const res = await reorderTasks({ block_id: fromBlock.id, task_ids: newIds });
        if (res.error) fail(res.error);
      });
      return;
    }

    // Mover entre bloques.
    const moving = fromBlock.tasks.find((x) => x.id === activeId)!;
    let insertIdx = toBlock.tasks.length;
    if (!isBlockId(overId)) {
      const oi = toBlock.tasks.findIndex((x) => x.id === overId);
      if (oi >= 0) insertIdx = oi;
    }
    const newToTasks = [...toBlock.tasks];
    newToTasks.splice(insertIdx, 0, moving);
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === fromBlock.id
          ? { ...b, tasks: b.tasks.filter((x) => x.id !== activeId) }
          : b.id === toBlockId
            ? { ...b, tasks: newToTasks }
            : b
      )
    );
    startTransition(async () => {
      const res = await moveTask({
        task_id: activeId,
        to_block_id: toBlockId,
        dest_ids: newToTasks.map((x) => x.id),
      });
      if (res.error) fail(res.error);
    });
  }

  function onAddTask(blockId: string, exerciseId: string, name: string) {
    startTransition(async () => {
      const res = await addBlockTask({ block_id: blockId, exercise_id: exerciseId });
      if (res.error || !res.id) {
        fail(res.error);
        return;
      }
      const newId = res.id;
      setBlocks((prev) =>
        prev.map((b) =>
          b.id !== blockId
            ? b
            : {
                ...b,
                tasks: [
                  ...b.tasks,
                  {
                    id: newId,
                    exercise_id: exerciseId,
                    exercise_name: name,
                    order_idx: b.tasks.length,
                    duration_min: null,
                    series: null,
                    notes: null,
                  },
                ],
              }
        )
      );
    });
  }

  function onRemoveTask(blockId: string, taskId: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.id !== blockId ? b : { ...b, tasks: b.tasks.filter((x) => x.id !== taskId) }))
    );
    startTransition(async () => {
      const res = await removeBlockTask({ id: taskId });
      if (res.error) fail(res.error);
    });
  }

  function onUpdateTask(
    blockId: string,
    taskId: string,
    patch: { duration_min: string; series: string; notes: string }
  ) {
    const durationNum = patch.duration_min.trim() === '' ? null : Number(patch.duration_min);
    setBlocks((prev) =>
      prev.map((b) =>
        b.id !== blockId
          ? b
          : {
              ...b,
              tasks: b.tasks.map((x) =>
                x.id !== taskId
                  ? x
                  : {
                      ...x,
                      duration_min: durationNum != null && !Number.isNaN(durationNum) ? durationNum : null,
                      series: patch.series.trim() === '' ? null : patch.series,
                      notes: patch.notes.trim() === '' ? null : patch.notes,
                    }
              ),
            }
      )
    );
    startTransition(async () => {
      const res = await updateBlockTask({
        id: taskId,
        duration_min: patch.duration_min,
        series: patch.series,
        notes: patch.notes,
      });
      if (res.error) fail(res.error);
    });
  }

  // ── Jugadas del bloque (JS-1) ──
  function onAddPlay(blockId: string, playId: string, name: string) {
    const frameCount = addablePlays.find((p) => p.id === playId)?.frame_count ?? 0;
    startTransition(async () => {
      const res = await addPlayToBlock({ block_id: blockId, play_id: playId });
      if (res.error || !res.id) {
        fail(res.error);
        return;
      }
      const newId = res.id;
      setBlocks((prev) =>
        prev.map((b) =>
          b.id !== blockId
            ? b
            : {
                ...b,
                plays: [
                  ...b.plays,
                  {
                    id: newId,
                    play_id: playId,
                    play_name: name,
                    frame_count: frameCount,
                    order_idx: b.plays.length,
                    duration_min: null,
                    notes: null,
                  },
                ],
              }
        )
      );
    });
  }

  function onRemovePlay(blockId: string, playRowId: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.id !== blockId ? b : { ...b, plays: b.plays.filter((x) => x.id !== playRowId) }))
    );
    startTransition(async () => {
      const res = await removePlayFromBlock({ id: playRowId });
      if (res.error) fail(res.error);
    });
  }

  function onUpdatePlay(
    blockId: string,
    playRowId: string,
    patch: { duration_min: string; notes: string }
  ) {
    const durationNum = patch.duration_min.trim() === '' ? null : Number(patch.duration_min);
    setBlocks((prev) =>
      prev.map((b) =>
        b.id !== blockId
          ? b
          : {
              ...b,
              plays: b.plays.map((x) =>
                x.id !== playRowId
                  ? x
                  : {
                      ...x,
                      duration_min: durationNum != null && !Number.isNaN(durationNum) ? durationNum : null,
                      notes: patch.notes.trim() === '' ? null : patch.notes,
                    }
              ),
            }
      )
    );
    startTransition(async () => {
      const res = await updateBlockPlay({
        id: playRowId,
        duration_min: patch.duration_min,
        notes: patch.notes,
      });
      if (res.error) fail(res.error);
    });
  }

  function onMovePlay(blockId: string, playRowId: string, dir: -1 | 1) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    const ids = block.plays.map((p) => p.id);
    const from = ids.indexOf(playRowId);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const newIds = arrayMove(ids, from, to);
    setBlocks((prev) =>
      prev.map((b) =>
        b.id !== blockId ? b : { ...b, plays: newIds.map((id) => b.plays.find((x) => x.id === id)!) }
      )
    );
    startTransition(async () => {
      const res = await reorderBlockPlays({ block_id: blockId, play_ids: newIds });
      if (res.error) fail(res.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">{t('sections.blocks')}</CardTitle>
        <span className="text-sm text-muted-foreground">
          {t('blocks.total')}: {total != null ? t('blocks.minutes', { count: total }) : '—'}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {blocks.map((block) => (
              <SortableBlock
                key={block.id}
                block={block}
                blockLabel={tBlocks(block.block_type)}
                pickable={pickable}
                addablePlays={addablePlays}
                hasTeam={hasTeam}
                defaultCategory={session.team_category_kind}
                defaultTactical={session.tactical_objectives}
                defaultTechnical={session.technical_objectives}
                onAddTask={onAddTask}
                onUpdateTask={onUpdateTask}
                onRemoveTask={onRemoveTask}
                onAddPlay={onAddPlay}
                onUpdatePlay={onUpdatePlay}
                onMovePlay={onMovePlay}
                onRemovePlay={onRemovePlay}
                pending={pending}
              />
            ))}
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}
