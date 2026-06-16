'use client';

/**
 * F11.5b (PR1) — <PitchEditor>. Editor visual del diagrama de un ejercicio.
 *
 * Construye ENCIMA del renderer read-only <DiagramView> (11.5a): éste pinta el
 * campo y los elementos (con `fill`, ocupando el contenedor); el editor solo
 * superpone la CAPA DE INTERACCIÓN (handles arrastrables + clic para colocar).
 * No duplica el pintado.
 *
 * Todo el ESTADO vive en el reducer PURO `pitchEditorReducer` de @misterfc/core
 * (testeado sin DOM). Aquí solo: traducir gestos del DOM a acciones y aplicar el
 * transform de dnd-kit para el preview local del arrastre. Al soltar se confirma
 * con UN solo MOVE (la granularidad del undo la decide el reducer).
 *
 * PR1: elementos de punto (jugador/balón/cono/aro/portería/miniportería/
 * gol_conducción/texto) + seleccionar/mover/borrar + undo/redo + selector de
 * campo (completo|medio). Flecha/línea/zona dibujadas llegan en PR2.
 *
 * Salida: `toDiagram(state)`, un Diagram que SIEMPRE pasa parseDiagram; se emite
 * por `onChange` para el consumidor (el harness y, en 11.6, el form de ejercicio).
 */

import { useEffect, useReducer, useRef } from 'react';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Undo2, Redo2, Trash2 } from 'lucide-react';
import {
  pitchEditorReducer,
  initEditorState,
  toDiagram,
  canUndo,
  canRedo,
  type Diagram,
  type DiagramElement,
  type PitchTool,
  type PlayerRole,
} from '@misterfc/core';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DiagramView, fieldAspectClass } from './diagram-view';

// Chrome del editor (dev/reusable). En 11.6 el form puede envolver estas
// etiquetas con i18n si hace falta; aquí van directas para no acoplar el
// componente al sistema de traducciones todavía.
const TOOL_BUTTONS: ReadonlyArray<{ tool: PitchTool; label: string }> = [
  { tool: 'select', label: 'Seleccionar' },
  { tool: 'jugador', label: 'Jugador' },
  { tool: 'balon', label: 'Balón' },
  { tool: 'cono', label: 'Cono' },
  { tool: 'aro', label: 'Aro' },
  { tool: 'porteria', label: 'Portería' },
  { tool: 'miniporteria', label: 'Miniportería' },
  { tool: 'gol_conduccion', label: 'Gol cond.' },
  { tool: 'texto', label: 'Texto' },
];

const ROLE_OPTIONS: ReadonlyArray<{ role: PlayerRole; label: string }> = [
  { role: 'atacante', label: 'Atacante' },
  { role: 'defensor', label: 'Defensor' },
  { role: 'comodin', label: 'Comodín' },
  { role: 'portero', label: 'Portero' },
];

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Elementos con ancla de un punto (los movibles/colocables en PR1). */
function isPointElement(
  el: DiagramElement,
): el is Extract<DiagramElement, { x_pct: number; y_pct: number }> {
  return 'x_pct' in el && 'y_pct' in el;
}

export function PitchEditor({
  initialDiagram,
  onChange,
  className,
}: {
  initialDiagram?: Diagram;
  onChange?: (diagram: Diagram) => void;
  className?: string;
}) {
  const [state, dispatch] = useReducer(pitchEditorReducer, initialDiagram, initEditorState);
  const rootRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    // Umbral de 8px: distingue un clic (seleccionar) de un arrastre (mover).
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const diagram = toDiagram(state);

  useEffect(() => {
    onChange?.(toDiagram(state));
  }, [state, onChange]);

  function pctFromEvent(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: round2(((clientX - rect.left) / rect.width) * 100),
      y: round2(((clientY - rect.top) / rect.height) * 100),
    };
  }

  // Clic en el fondo del campo: colocar (herramienta activa) o deseleccionar.
  // Los handles hacen stopPropagation, así que aquí solo llegan clics "vacíos".
  function handleBackgroundClick(e: React.MouseEvent<HTMLDivElement>) {
    if (state.tool === 'select') {
      dispatch({ type: 'SELECT', id: null });
      return;
    }
    const pt = pctFromEvent(e.clientX, e.clientY);
    if (pt) dispatch({ type: 'PLACE', x_pct: pt.x, y_pct: pt.y });
  }

  // Al soltar: nueva posición = actual + desplazamiento (px → %), acotada.
  function handleDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const el = state.elements.find((x) => x.id === id);
    if (!el || !isPointElement(el)) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    dispatch({
      type: 'MOVE',
      id,
      x_pct: round2(el.x_pct + (e.delta.x / rect.width) * 100),
      y_pct: round2(el.y_pct + (e.delta.y / rect.height) * 100),
    });
  }

  const selected = state.elements.find((e) => e.id === state.selectedId) ?? null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-2">
        {TOOL_BUTTONS.map((b) => (
          <Button
            key={b.tool}
            type="button"
            size="sm"
            variant={state.tool === b.tool ? 'default' : 'outline'}
            onClick={() => dispatch({ type: 'SET_TOOL', tool: b.tool })}
            aria-pressed={state.tool === b.tool}
          >
            {b.label}
          </Button>
        ))}
        <div className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={!canUndo(state)}
          onClick={() => dispatch({ type: 'UNDO' })}
          aria-label="Deshacer"
        >
          <Undo2 className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={!canRedo(state)}
          onClick={() => dispatch({ type: 'REDO' })}
          aria-label="Rehacer"
        >
          <Redo2 className="size-4" aria-hidden />
        </Button>
      </div>

      {/* Config del próximo elemento + selector de campo */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Campo</span>
        <Button
          type="button"
          size="sm"
          variant={state.field.kind === 'completo' ? 'default' : 'outline'}
          onClick={() => dispatch({ type: 'SET_FIELD_KIND', kind: 'completo' })}
        >
          Completo
        </Button>
        <Button
          type="button"
          size="sm"
          variant={state.field.kind === 'medio' ? 'default' : 'outline'}
          onClick={() => dispatch({ type: 'SET_FIELD_KIND', kind: 'medio' })}
        >
          Medio
        </Button>

        {state.tool === 'jugador' && (
          <>
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={state.nextRole}
              onChange={(e) => dispatch({ type: 'SET_NEXT_ROLE', role: e.target.value as PlayerRole })}
              aria-label="Rol del jugador"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
            <Input
              className="h-9 w-28"
              placeholder="Etiqueta"
              value={state.nextLabel}
              onChange={(e) => dispatch({ type: 'SET_NEXT_LABEL', label: e.target.value })}
              aria-label="Etiqueta del próximo jugador"
            />
          </>
        )}

        {state.tool === 'texto' && (
          <>
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Input
              className="h-9 w-40"
              placeholder="Texto"
              value={state.nextText}
              onChange={(e) => dispatch({ type: 'SET_NEXT_TEXT', text: e.target.value })}
              aria-label="Texto del próximo elemento"
            />
          </>
        )}
      </div>

      {/* Campo: renderer read-only + capa de interacción */}
      <div
        ref={rootRef}
        className={cn(
          'relative mx-auto w-full max-w-md overflow-hidden rounded-lg border',
          fieldAspectClass(state.field),
          state.tool !== 'select' && 'cursor-crosshair',
        )}
        onClick={handleBackgroundClick}
      >
        <DiagramView diagram={diagram} fill />
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {state.elements.map((el) =>
            isPointElement(el) ? (
              <ElementHandle
                key={el.id}
                id={el.id}
                xPct={el.x_pct}
                yPct={el.y_pct}
                selected={state.selectedId === el.id}
                onSelect={() => dispatch({ type: 'SELECT', id: el.id })}
              />
            ) : null,
          )}
        </DndContext>
      </div>

      {/* Editor inline del elemento seleccionado (textos libres + borrar) */}
      {selected && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
          <span className="font-medium capitalize">{selected.type}</span>
          {selected.type === 'jugador' && (
            <Input
              key={selected.id}
              className="h-9 w-32"
              placeholder="Etiqueta"
              defaultValue={selected.label ?? ''}
              onBlur={(e) => dispatch({ type: 'UPDATE_LABEL', id: selected.id, label: e.target.value })}
              aria-label="Etiqueta del jugador"
            />
          )}
          {selected.type === 'texto' && (
            <Input
              key={selected.id}
              className="h-9 w-48"
              defaultValue={selected.text}
              onBlur={(e) => dispatch({ type: 'UPDATE_TEXT', id: selected.id, text: e.target.value })}
              aria-label="Texto"
            />
          )}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="ml-auto gap-1"
            onClick={() => dispatch({ type: 'DELETE', id: selected.id })}
          >
            <Trash2 className="size-4" aria-hidden />
            Borrar
          </Button>
        </div>
      )}
    </div>
  );
}

/** Handle arrastrable sobre un elemento de punto. El centrado va en el wrapper
 *  (left/top %) y el transform de dnd en el botón, para no pisar el translate
 *  de centrado durante el arrastre. */
function ElementHandle({
  id,
  xPct,
  yPct,
  selected,
  onSelect,
}: {
  id: string;
  xPct: number;
  yPct: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
    >
      <button
        type="button"
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform) }}
        className={cn(
          'size-7 cursor-grab touch-none rounded-full border-2 active:cursor-grabbing',
          selected ? 'border-white bg-white/30 ring-2 ring-white' : 'border-white/50 bg-white/10',
          isDragging && 'z-20 opacity-80',
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        aria-label={`Elemento ${id}`}
        {...listeners}
        {...attributes}
      />
    </div>
  );
}
