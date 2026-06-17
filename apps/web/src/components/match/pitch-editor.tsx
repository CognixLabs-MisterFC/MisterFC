'use client';

/**
 * F11.5b — <PitchEditor>. Editor visual del diagrama de un ejercicio.
 *
 * Construye ENCIMA del renderer read-only <DiagramView> (11.5a): éste pinta el
 * campo y los elementos (con `fill`); el editor superpone solo la CAPA DE
 * INTERACCIÓN (handles + clic para colocar + rubber-band para dibujar).
 *
 * Todo el ESTADO documental vive en el reducer PURO `pitchEditorReducer` de
 * @misterfc/core (testeado sin DOM). El dibujo EN CURSO (rubber-band) es estado
 * EFÍMERO local (no entra al reducer ni al historial); al soltar se confirma con
 * UNA acción (ADD_ARROW/ADD_LINE/ADD_ZONA) = 1 paso de undo.
 *
 * PR1: elementos de punto + seleccionar/mover/borrar + undo/redo + campo.
 * PR2: flecha/línea/zona dibujadas (arrastrar) + mover (trasladar) + editar
 * style/stroke inline.
 *
 * Salida: `toDiagram(state)`, un Diagram que SIEMPRE pasa parseDiagram.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  simplifyStroke,
  DRAW_TOOLS,
  FREEHAND_TOOL,
  type Diagram,
  type DiagramElement,
  type DiagramPoint,
  type PitchTool,
  type PlayerRole,
  type ArrowStyle,
  type StrokeKind,
  type ZoneFill,
  type StrokeColor,
  type ElementSize,
} from '@misterfc/core';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DiagramView, fieldAspectClass } from './diagram-view';

// Chrome del editor (dev/reusable). En 11.6 el form puede envolver con i18n.
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
  { tool: 'flecha', label: 'Flecha' },
  { tool: 'linea', label: 'Línea' },
  { tool: FREEHAND_TOOL, label: 'Dibujo libre' },
  { tool: 'zona', label: 'Zona' },
];

// Color de trazo de flecha/linea/dibujo libre. 'black' = sin color = negro (default).
const colorFromSelect = (v: string): StrokeColor | null =>
  v === 'blue' ? 'blue' : v === 'red' ? 'red' : null;
// Herramientas que admiten color de trazo (flecha + linea + dibujo libre).
const COLOR_TOOLS = new Set<PitchTool>(['flecha', 'linea', FREEHAND_TOOL]);

const ROLE_OPTIONS: ReadonlyArray<{ role: PlayerRole; label: string }> = [
  { role: 'atacante', label: 'Atacante' },
  { role: 'defensor', label: 'Defensor' },
  { role: 'comodin', label: 'Comodín' },
  { role: 'portero', label: 'Portero' },
];
const ARROW_STYLE_OPTIONS: ReadonlyArray<{ style: ArrowStyle; label: string }> = [
  { style: 'pase', label: 'Pase' },
  { style: 'conduccion', label: 'Conducción' },
  { style: 'desmarque', label: 'Desmarque' },
];
const STROKE_OPTIONS: ReadonlyArray<{ stroke: StrokeKind; label: string }> = [
  { stroke: 'solid', label: 'Sólida' },
  { stroke: 'dashed', label: 'Discontinua' },
];
// Relleno de la zona ('none' = sin relleno = contorno; default). Solo verde por ahora.
const FILL_OPTIONS: ReadonlyArray<{ value: 'none' | ZoneFill; label: string }> = [
  { value: 'none', label: 'Ninguno' },
  { value: 'green', label: 'Verde' },
];
const fillFromSelect = (v: string): ZoneFill | null => (v === 'green' ? 'green' : null);
// Orden de presentación acordado: Grande / Mediano / Pequeño (default Mediano).
const SIZE_OPTIONS: ReadonlyArray<{ size: ElementSize; label: string }> = [
  { size: 'lg', label: 'Grande' },
  { size: 'md', label: 'Mediano' },
  { size: 'sm', label: 'Pequeño' },
];
// Tipos de PUNTO (llevan size). flecha/línea/zona van por geometría.
const SIZE_CAPABLE = new Set<DiagramElement['type']>([
  'jugador',
  'balon',
  'cono',
  'aro',
  'gol_conduccion',
  'porteria',
  'miniporteria',
  'texto',
]);

const round2 = (v: number): number => Math.round(v * 100) / 100;
const DRAW_MIN_DIST = 1.5; // % mínimo de arrastre para confirmar un dibujo

const POINT_TYPES = new Set<DiagramElement['type']>([
  'jugador',
  'balon',
  'cono',
  'aro',
  'gol_conduccion',
  'porteria',
  'miniporteria',
  'texto',
]);
const isPointElement = (
  el: DiagramElement,
): el is Extract<DiagramElement, { x_pct: number; y_pct: number; type: never }> | Extract<DiagramElement, { type: 'jugador' }> =>
  POINT_TYPES.has(el.type);

type Pt = { x: number; y: number };

/** Caja contenedora del elemento (en %), para el hit-target de los dibujados. */
function elementBBox(el: DiagramElement): { x: number; y: number; w: number; h: number } {
  switch (el.type) {
    case 'flecha':
    case 'cota': {
      const x = Math.min(el.from.x_pct, el.to.x_pct);
      const y = Math.min(el.from.y_pct, el.to.y_pct);
      return { x, y, w: Math.abs(el.to.x_pct - el.from.x_pct), h: Math.abs(el.to.y_pct - el.from.y_pct) };
    }
    case 'linea': {
      const xs = el.points.map((p) => p.x_pct);
      const ys = el.points.map((p) => p.y_pct);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case 'zona':
      return { x: el.x_pct, y: el.y_pct, w: el.w_pct, h: el.h_pct };
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
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
  // i18n: en F11B.0 solo se localizan las ETIQUETAS DE COLOR (D9 completa = 11B.1).
  const tColor = useTranslations('pitchEditor.color');
  const COLOR_OPTIONS: ReadonlyArray<{ value: 'black' | StrokeColor; label: string }> = [
    { value: 'black', label: tColor('black') },
    { value: 'blue', label: tColor('blue') },
    { value: 'red', label: tColor('red') },
  ];

  const [state, dispatch] = useReducer(pitchEditorReducer, initialDiagram, initEditorState);
  const rootRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  // Dibujo en curso (rubber-band): EFÍMERO, no entra al reducer ni al historial.
  const [draw, setDraw] = useState<{ from: Pt; to: Pt } | null>(null);
  // Trazo a mano alzada en curso (F11B.0): EFÍMERO, se simplifica al soltar.
  const [freehand, setFreehand] = useState<Pt[] | null>(null);

  const diagram = toDiagram(state);
  const isRubberTool = (DRAW_TOOLS as readonly string[]).includes(state.tool);
  const isFreehandTool = state.tool === FREEHAND_TOOL;
  // Cualquier herramienta que captura el puntero (rubber-band o mano alzada).
  const isDrawTool = isRubberTool || isFreehandTool;

  useEffect(() => {
    onChange?.(toDiagram(state));
  }, [state, onChange]);

  function pctFromEvent(clientX: number, clientY: number): Pt | null {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: round2(((clientX - rect.left) / rect.width) * 100),
      y: round2(((clientY - rect.top) / rect.height) * 100),
    };
  }

  function handleBackgroundClick(e: React.MouseEvent<HTMLDivElement>) {
    if (isDrawTool) return; // el dibujo lo gestionan los pointer handlers
    if (state.tool === 'select') {
      dispatch({ type: 'SELECT', id: null });
      return;
    }
    const pt = pctFromEvent(e.clientX, e.clientY);
    if (pt) dispatch({ type: 'PLACE', x_pct: pt.x, y_pct: pt.y });
  }

  // ── Captura por puntero (rubber-band o mano alzada) ────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDrawTool) return;
    if ((e.target as HTMLElement).closest('[data-handle]')) return; // no sobre un handle
    const pt = pctFromEvent(e.clientX, e.clientY);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (isFreehandTool) setFreehand([pt]);
    else setDraw({ from: pt, to: pt });
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pt = pctFromEvent(e.clientX, e.clientY);
    if (!pt) return;
    if (freehand) {
      // Muestrea el recorrido; decima por distancia mínima para no saturar.
      setFreehand((pts) => {
        if (!pts) return pts;
        const last = pts[pts.length - 1];
        if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.4) return pts;
        return [...pts, pt];
      });
    } else if (draw) {
      setDraw((d) => (d ? { ...d, to: pt } : null));
    }
  }
  function handlePointerUp() {
    // Trazo a mano alzada: simplifica y confirma como un `linea` (1 paso de undo).
    if (freehand) {
      const pts = freehand;
      setFreehand(null);
      if (pts.length < 2) return;
      const total = pts.reduce(
        (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y)),
        0,
      );
      if (total < DRAW_MIN_DIST) return; // ignora un toque/microtrazo
      const points: DiagramPoint[] = simplifyStroke(pts.map((p) => ({ x_pct: p.x, y_pct: p.y })));
      if (points.length >= 2) dispatch({ type: 'ADD_FREEHAND', points });
      return;
    }
    if (!draw) return;
    const { from, to } = draw;
    setDraw(null);
    if (Math.hypot(to.x - from.x, to.y - from.y) < DRAW_MIN_DIST) return; // ignora clic/microdrag
    const fromP = { x_pct: from.x, y_pct: from.y };
    const toP = { x_pct: to.x, y_pct: to.y };
    if (state.tool === 'flecha') dispatch({ type: 'ADD_ARROW', from: fromP, to: toP });
    else if (state.tool === 'linea') dispatch({ type: 'ADD_LINE', from: fromP, to: toP });
    else if (state.tool === 'zona') dispatch({ type: 'ADD_ZONA', from: fromP, to: toP });
  }

  // ── Mover (drop): punto → MOVE absoluto; dibujado → TRANSLATE por delta ─────
  function handleDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const el = state.elements.find((x) => x.id === id);
    if (!el) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const dx = (e.delta.x / rect.width) * 100;
    const dy = (e.delta.y / rect.height) * 100;
    if (isPointElement(el)) {
      dispatch({ type: 'MOVE', id, x_pct: round2(el.x_pct + dx), y_pct: round2(el.y_pct + dy) });
    } else {
      dispatch({ type: 'TRANSLATE', id, dx: round2(dx), dy: round2(dy) });
    }
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

      {/* Tamaño del próximo elemento de punto (debajo de las herramientas, encima de Campo) */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Tamaño</span>
        {SIZE_OPTIONS.map((o) => (
          <Button
            key={o.size}
            type="button"
            size="sm"
            variant={state.nextSize === o.size ? 'default' : 'outline'}
            onClick={() => dispatch({ type: 'SET_NEXT_SIZE', size: o.size })}
            aria-pressed={state.nextSize === o.size}
          >
            {o.label}
          </Button>
        ))}
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

        {state.tool === 'flecha' && (
          <>
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={state.nextArrowStyle}
              onChange={(e) => dispatch({ type: 'SET_NEXT_ARROW_STYLE', style: e.target.value as ArrowStyle })}
              aria-label="Estilo de flecha"
            >
              {ARROW_STYLE_OPTIONS.map((o) => (
                <option key={o.style} value={o.style}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}

        {(state.tool === 'linea' || state.tool === 'zona') && (
          <>
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={state.nextStroke}
              onChange={(e) => dispatch({ type: 'SET_NEXT_STROKE', stroke: e.target.value as StrokeKind })}
              aria-label="Trazo"
            >
              {STROKE_OPTIONS.map((o) => (
                <option key={o.stroke} value={o.stroke}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}

        {state.tool === 'zona' && (
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={state.nextFill ?? 'none'}
            onChange={(e) => dispatch({ type: 'SET_NEXT_FILL', fill: fillFromSelect(e.target.value) })}
            aria-label="Relleno"
          >
            {FILL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {COLOR_TOOLS.has(state.tool) && (
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={state.nextColor ?? 'black'}
            onChange={(e) => dispatch({ type: 'SET_NEXT_COLOR', color: colorFromSelect(e.target.value) })}
            aria-label={tColor('aria')}
          >
            {COLOR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Campo: renderer read-only + capa de interacción */}
      <div
        ref={rootRef}
        data-testid="pitch-field"
        className={cn(
          'relative mx-auto w-full max-w-md touch-none overflow-hidden rounded-lg border',
          fieldAspectClass(state.field),
          state.tool !== 'select' && 'cursor-crosshair',
        )}
        onClick={handleBackgroundClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <DiagramView diagram={diagram} fill />

        {/* Preview del trazo a mano alzada en curso (no interactivo) */}
        {freehand && freehand.length >= 2 && (
          <svg
            className="pointer-events-none absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polyline
              points={freehand.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#fff"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {/* Preview del dibujo en curso (no interactivo) */}
        {draw && (
          <svg
            className="pointer-events-none absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {state.tool === 'zona' ? (
              <rect
                x={Math.min(draw.from.x, draw.to.x)}
                y={Math.min(draw.from.y, draw.to.y)}
                width={Math.abs(draw.to.x - draw.from.x)}
                height={Math.abs(draw.to.y - draw.from.y)}
                fill={state.nextFill === 'green' ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.12)'}
                stroke="#fff"
                strokeWidth={1.5}
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <line
                x1={draw.from.x}
                y1={draw.from.y}
                x2={draw.to.x}
                y2={draw.to.y}
                stroke="#fff"
                strokeWidth={1.5}
                strokeDasharray={state.tool === 'linea' ? '3 2' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}

        {/* Handles de seleccionar/mover SOLO en modo Seleccionar: con una
            herramienta de colocar/dibujar activa, el clic/arrastre siempre
            coloca o dibuja (no agarra elementos existentes). */}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {state.tool === 'select' && state.elements.map((el) =>
            isPointElement(el) ? (
              <PointHandle
                key={el.id}
                id={el.id}
                xPct={el.x_pct}
                yPct={el.y_pct}
                selected={state.selectedId === el.id}
                onSelect={() => dispatch({ type: 'SELECT', id: el.id })}
              />
            ) : (
              <DrawnHandle
                key={el.id}
                id={el.id}
                bbox={elementBBox(el)}
                selected={state.selectedId === el.id}
                onSelect={() => dispatch({ type: 'SELECT', id: el.id })}
              />
            ),
          )}
        </DndContext>
      </div>

      {/* Editor inline del seleccionado */}
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
          {selected.type === 'flecha' && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.style}
              onChange={(e) => dispatch({ type: 'UPDATE_ARROW_STYLE', id: selected.id, style: e.target.value as ArrowStyle })}
              aria-label="Estilo de flecha"
            >
              {ARROW_STYLE_OPTIONS.map((o) => (
                <option key={o.style} value={o.style}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {(selected.type === 'linea' || selected.type === 'zona') && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.stroke ?? 'solid'}
              onChange={(e) => dispatch({ type: 'UPDATE_STROKE', id: selected.id, stroke: e.target.value as StrokeKind })}
              aria-label="Trazo"
            >
              {STROKE_OPTIONS.map((o) => (
                <option key={o.stroke} value={o.stroke}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {selected.type === 'zona' && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.fill ?? 'none'}
              onChange={(e) => dispatch({ type: 'UPDATE_FILL', id: selected.id, fill: fillFromSelect(e.target.value) })}
              aria-label="Relleno"
            >
              {FILL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {(selected.type === 'flecha' || selected.type === 'linea') && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.color ?? 'black'}
              onChange={(e) => dispatch({ type: 'UPDATE_COLOR', id: selected.id, color: colorFromSelect(e.target.value) })}
              aria-label={tColor('aria')}
            >
              {COLOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {SIZE_CAPABLE.has(selected.type) && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={'size' in selected ? selected.size ?? 'md' : 'md'}
              onChange={(e) => dispatch({ type: 'UPDATE_SIZE', id: selected.id, size: e.target.value as ElementSize })}
              aria-label="Tamaño"
            >
              {SIZE_OPTIONS.map((o) => (
                <option key={o.size} value={o.size}>
                  {o.label}
                </option>
              ))}
            </select>
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

/** Handle de punto: centrado en (x,y); el transform de dnd va en el botón para
 *  no pisar el translate de centrado. Transparente salvo selección. */
function PointHandle({
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
        data-handle
        style={{ transform: CSS.Translate.toString(transform) }}
        className={cn(
          'size-7 cursor-grab touch-none rounded-full border-2 border-transparent bg-transparent',
          'active:cursor-grabbing hover:bg-white/10',
          selected && 'border-white bg-white/20 ring-2 ring-white hover:bg-white/20',
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

/** Hit-target de un elemento dibujado: caja transparente sobre su bbox (con un
 *  pequeño margen para poder agarrar líneas finas). Realce dashed al seleccionar. */
function DrawnHandle({
  id,
  bbox,
  selected,
  onSelect,
}: {
  id: string;
  bbox: { x: number; y: number; w: number; h: number };
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const PAD = 2.5;
  const x = Math.max(0, bbox.x - PAD);
  const y = Math.max(0, bbox.y - PAD);
  const w = bbox.w + 2 * PAD;
  const h = bbox.h + 2 * PAD;
  return (
    <button
      type="button"
      ref={setNodeRef}
      data-handle
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: `${h}%`,
        transform: CSS.Translate.toString(transform),
      }}
      className={cn(
        'absolute cursor-grab touch-none rounded-sm border-2 border-transparent bg-transparent',
        'active:cursor-grabbing hover:bg-white/5',
        selected && 'border-dashed border-white bg-white/5',
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
  );
}
