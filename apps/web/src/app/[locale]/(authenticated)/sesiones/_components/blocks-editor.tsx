'use client';

/**
 * F12.2b — Editor de BLOQUES de la sesión: añadir ejercicios (picker filtrado),
 * editar los overrides del día (duración/series/notas) inline, quitar tareas y
 * REORDENAR bloques y tareas con dnd-kit (ratón + táctil + teclado). El
 * total_minutes de la cabecera = suma de los duration_min (derivado; aquí se
 * muestra en vivo con sumTaskMinutes y el trigger lo persiste).
 *
 * Estado local de `blocks` como fuente durante la edición: las mutaciones llaman a
 * las server actions (RLS = gate) y actualizan el estado; el reorden es optimista
 * y persiste en segundo plano (revierte con refresh si falla).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { sumTaskMinutes } from '@misterfc/core';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from '@/i18n/navigation';
import { ExercisePicker } from './exercise-picker';
import {
  addBlockTask,
  updateBlockTask,
  removeBlockTask,
  reorderBlocks,
  reorderTasks,
} from '../actions';
import type {
  SessionForEdit,
  SessionBlockForEdit,
  SessionTaskForEdit,
  PickableExercise,
} from '../queries';

function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
}

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

// ── Bloque sortable (cabecera con handle + tareas sortables + picker) ─────────
function SortableBlock({
  block,
  blockLabel,
  pickable,
  defaultCategory,
  defaultTactical,
  defaultTechnical,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onReorderTasks,
  pending,
}: {
  block: SessionBlockForEdit;
  blockLabel: string;
  pickable: PickableExercise[];
  defaultCategory: string | null;
  defaultTactical: string[];
  defaultTechnical: string[];
  onAddTask: (blockId: string, exerciseId: string, name: string) => void;
  onUpdateTask: (blockId: string, taskId: string, patch: { duration_min: string; series: string; notes: string }) => void;
  onRemoveTask: (blockId: string, taskId: string) => void;
  onReorderTasks: (blockId: string, orderedTaskIds: string[]) => void;
  pending: boolean;
}) {
  const t = useTranslations('sesiones.blocks');
  const sensors = useDragSensors();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  function onTaskDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = block.tasks.map((x) => x.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    onReorderTasks(block.id, arrayMove(ids, from, to));
  }

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
        {block.tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('empty')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTaskDragEnd}>
            <SortableContext items={block.tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
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
            </SortableContext>
          </DndContext>
        )}

        <div>
          <ExercisePicker
            exercises={pickable}
            defaultCategory={defaultCategory}
            defaultTactical={defaultTactical}
            defaultTechnical={defaultTechnical}
            onPick={(id, name) => onAddTask(block.id, id, name)}
            disabled={pending}
          />
        </div>
      </div>
    </div>
  );
}

// ── Editor de bloques (orquesta estado + mutaciones + reorden de bloques) ─────
export function BlocksEditor({
  session,
  pickable,
}: {
  session: SessionForEdit;
  pickable: PickableExercise[];
}) {
  const t = useTranslations('sesiones');
  const tBlocks = useTranslations('sesiones.block_types');
  const router = useRouter();
  const sensors = useDragSensors();
  const [blocks, setBlocks] = useState<SessionBlockForEdit[]>(session.blocks);
  const [pending, startTransition] = useTransition();

  const total = sumTaskMinutes(blocks.flatMap((b) => b.tasks.map((x) => x.duration_min)));

  function fail(err: string | undefined) {
    toast.error(t(`errors.${err ?? 'generic'}`));
    router.refresh();
  }

  function onBlockDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = blocks.map((b) => b.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    const next = arrayMove(blocks, from, to);
    setBlocks(next);
    startTransition(async () => {
      const res = await reorderBlocks({ session_id: session.id, block_ids: next.map((b) => b.id) });
      if (res.error) fail(res.error);
    });
  }

  function onReorderTasks(blockId: string, orderedTaskIds: string[]) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id !== blockId
          ? b
          : { ...b, tasks: orderedTaskIds.map((id) => b.tasks.find((x) => x.id === id)!).filter(Boolean) }
      )
    );
    startTransition(async () => {
      const res = await reorderTasks({ block_id: blockId, task_ids: orderedTaskIds });
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">{t('sections.blocks')}</CardTitle>
        <span className="text-sm text-muted-foreground">
          {t('blocks.total')}: {total != null ? t('blocks.minutes', { count: total }) : '—'}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onBlockDragEnd}>
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {blocks.map((block) => (
              <SortableBlock
                key={block.id}
                block={block}
                blockLabel={tBlocks(block.block_type)}
                pickable={pickable}
                defaultCategory={session.team_category_kind}
                defaultTactical={session.tactical_objectives}
                defaultTechnical={session.technical_objectives}
                onAddTask={onAddTask}
                onUpdateTask={onUpdateTask}
                onRemoveTask={onRemoveTask}
                onReorderTasks={onReorderTasks}
                pending={pending}
              />
            ))}
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}
