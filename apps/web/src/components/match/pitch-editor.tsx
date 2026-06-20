'use client';

/**
 * F11.5b / F11B — Editor visual del diagrama (capa de interacción reutilizable).
 *
 * `<PitchBoard>` es el núcleo: estado (reducer PURO `pitchEditorReducer`), barra
 * de herramientas y la CAPA DE INTERACCIÓN (handles + clic para colocar +
 * rubber-band + trazo libre). El FONDO del campo lo provee el consumidor con el
 * render-prop `renderField` — así la MISMA capa de dibujo sirve sobre:
 *   - `<DiagramView>` (campo del ejercicio) → `<PitchEditor>` (F11, default).
 *   - `<MatchFieldEditor>` (once real) → pizarra F11B.2.
 * Los dibujos confirmados se pintan SIEMPRE con `<DiagramView showField={false}>`
 * (solo elementos) encima del fondo, sin duplicar las marcas del campo.
 *
 * El dibujo EN CURSO (rubber-band / mano alzada) es estado EFÍMERO local (no
 * entra al reducer ni al historial); al soltar se confirma con UNA acción
 * (ADD_ARROW/ADD_LINE/ADD_ZONA/ADD_FREEHAND) = 1 paso de undo.
 *
 * Salida: `toDiagram(state)`, un Diagram que SIEMPRE pasa parseDiagram.
 */

import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS, type Transform } from '@dnd-kit/utilities';
import { Undo2, Redo2, Trash2, Eraser, Download } from 'lucide-react';
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
  type DiagramField,
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
import { useFitBox } from '@/hooks/use-fit-box';
import { DiagramView, fieldAspectClass, isDegradedField } from './diagram-view';

// Chrome del editor: orden de las herramientas/opciones. Las ETIQUETAS se
// localizan en render con `useTranslations('pitchEditor')` (D9, F11B.1).
const TOOL_ORDER: ReadonlyArray<PitchTool> = [
  'select',
  'jugador',
  'balon',
  'cono',
  'aro',
  'porteria',
  'miniporteria',
  'gol_conduccion',
  'texto',
  'flecha',
  'linea',
  FREEHAND_TOOL,
  'zona',
];

// Color de trazo de flecha/linea/dibujo libre. 'black' = sin color = negro (default).
const colorFromSelect = (v: string): StrokeColor | null =>
  v === 'blue' ? 'blue' : v === 'red' ? 'red' : null;
// Herramientas que admiten color de trazo (flecha + linea + dibujo libre).
const COLOR_TOOLS = new Set<PitchTool>(['flecha', 'linea', FREEHAND_TOOL]);
const COLOR_VALUES: ReadonlyArray<'black' | StrokeColor> = ['black', 'blue', 'red'];

const ROLE_ORDER: ReadonlyArray<PlayerRole> = ['atacante', 'defensor', 'comodin', 'portero'];
const ARROW_STYLE_ORDER: ReadonlyArray<ArrowStyle> = ['pase', 'conduccion', 'desmarque'];
const STROKE_ORDER: ReadonlyArray<StrokeKind> = ['solid', 'dashed'];
// Relleno de la zona ('none' = sin relleno = contorno; default). Solo verde por ahora.
const FILL_VALUES: ReadonlyArray<'none' | ZoneFill> = ['none', 'green'];
const fillFromSelect = (v: string): ZoneFill | null => (v === 'green' ? 'green' : null);
// Orden de presentación acordado: Grande / Mediano / Pequeño (default Mediano).
const SIZE_ORDER: ReadonlyArray<ElementSize> = ['lg', 'md', 'sm'];
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

/** F11B.3 — Rasteriza un <svg> del DOM a una Image, fijando tamaño explícito
 *  (las clases CSS no aplican en el data-URL; viewBox + width/height mandan). */
function svgToImage(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

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

/** Fondo del campo: lo provee el consumidor. Recibe el diagrama y el campo
 *  actuales; debe rellenar el contenedor (absolute inset-0). */
export type RenderField = (args: { diagram: Diagram; field: DiagramField }) => ReactNode;

/** Fondo por defecto (F11): el propio `<DiagramView>` pinta campo + elementos. */
const defaultRenderField: RenderField = ({ diagram }) => <DiagramView diagram={diagram} fill />;

export function PitchBoard({
  initialDiagram,
  onChange,
  showClear = false,
  showExport = false,
  renderField = defaultRenderField,
  lockFieldKind = false,
  fill = false,
  fillRotationDeg = 0,
  className,
}: {
  initialDiagram?: Diagram;
  onChange?: (diagram: Diagram) => void;
  /** Muestra el botón "Limpiar todo" en la barra (F11B.1, pizarra). Off por
   *  defecto para no alterar el editor de ejercicios de F11. */
  showClear?: boolean;
  /** Muestra "Descargar imagen" (F11B.3). Solo para fondos SVG puros
   *  (blanco/ejercicio): el snapshot serializa las capas <svg>. NO usar en el
   *  once real (chips HTML/CSS + fotos cross-origin no se compositan — diferido). */
  showExport?: boolean;
  /** Fondo del campo. Default = `<DiagramView>` (F11). F11B.2 pasa el once real. */
  renderField?: RenderField;
  /** Oculta el selector Completo/Medio (F11B.2: once real fijo completo). */
  lockFieldKind?: boolean;
  /** F13.0 — el campo LLENA el alto disponible (en vez de `max-w-md`). Para
   *  fullscreen. Off por defecto: no altera ningún uso existente del editor. */
  fill?: boolean;
  /** F13.0 — gira la unidad-campo (campo+tinta) como bloque rígido: 90 = apaisado.
   *  Las coordenadas NO se mutan; el puntero/drag compensan la rotación. */
  fillRotationDeg?: 0 | 90;
  className?: string;
}) {
  // D9 (F11B.1): todas las etiquetas del editor se localizan aquí.
  const t = useTranslations('pitchEditor');

  const [state, dispatch] = useReducer(pitchEditorReducer, initialDiagram, initEditorState);
  const rootRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  // Dibujo en curso (rubber-band): EFÍMERO, no entra al reducer ni al historial.
  const [draw, setDraw] = useState<{ from: Pt; to: Pt } | null>(null);
  // Trazo a mano alzada en curso (F11B.0): EFÍMERO, se simplifica al soltar.
  const [freehand, setFreehand] = useState<Pt[] | null>(null);

  // F13.0 — fill/rotación de la unidad-campo (fullscreen). Aspecto = w/h del
  // lienzo (completo 2/3, medio 4/3; degrada a 2/3). Off → no se mide nada útil.
  const fieldAspectNum = isDegradedField(state.field)
    ? 2 / 3
    : state.field.kind === 'medio'
      ? 4 / 3
      : 2 / 3;
  const { containerRef: fitRef, style: fitStyle } = useFitBox(
    fieldAspectNum,
    fill ? fillRotationDeg : 0,
  );

  const diagram = toDiagram(state);
  const isRubberTool = (DRAW_TOOLS as readonly string[]).includes(state.tool);
  const isFreehandTool = state.tool === FREEHAND_TOOL;
  // Cualquier herramienta que captura el puntero (rubber-band o mano alzada).
  const isDrawTool = isRubberTool || isFreehandTool;

  useEffect(() => {
    onChange?.(toDiagram(state));
  }, [state, onChange]);

  // F13.0 — ¿la unidad-campo está rotada 90° (fullscreen apaisado)? El puntero y
  // el drag compensan la rotación para que las coords % no se muten.
  const rotated = fill && fillRotationDeg === 90;

  function pctFromEvent(clientX: number, clientY: number): Pt | null {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    if (rotated) {
      // rect = AABB de la unidad rotada: rect.width = alto pre-rotación (h),
      // rect.height = ancho (w). Des-rotamos el punto respecto al centro.
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const wEl = rect.height; // ancho pre-rotación
      const hEl = rect.width; // alto pre-rotación
      return {
        x: round2(((dy + wEl / 2) / wEl) * 100),
        y: round2(((-dx + hEl / 2) / hEl) * 100),
      };
    }
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
    // Rotado: el delta de pantalla se des-rota a coords del campo (rect ya es el
    // AABB rotado → wEl = rect.height, hEl = rect.width).
    const dx = rotated ? (e.delta.y / rect.height) * 100 : (e.delta.x / rect.width) * 100;
    const dy = rotated ? (-e.delta.x / rect.width) * 100 : (e.delta.y / rect.height) * 100;
    if (isPointElement(el)) {
      dispatch({ type: 'MOVE', id, x_pct: round2(el.x_pct + dx), y_pct: round2(el.y_pct + dy) });
    } else {
      dispatch({ type: 'TRANSLATE', id, dx: round2(dx), dy: round2(dy) });
    }
  }

  // F11B.3 — Snapshot a PNG: serializa las capas <svg> del board (campo +
  // dibujos) y las compone en un canvas. Efímero (no persiste). Solo en fondos
  // SVG puros (blanco/ejercicio); el once real no se exporta aún (chips HTML).
  async function handleExport() {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = 2; // nitidez
    const W = Math.round(rect.width * scale);
    const H = Math.round(rect.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const svgs = Array.from(root.querySelectorAll('svg'));
    for (const svg of svgs) {
      try {
        const img = await svgToImage(svg, rect.width, rect.height);
        ctx.drawImage(img, 0, 0, W, H);
      } catch {
        // Si una capa no rasteriza, se omite (no bloquea el resto del PNG).
      }
    }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'pizarra.png';
    a.click();
  }

  const selected = state.elements.find((e) => e.id === state.selectedId) ?? null;

  return (
    <div className={cn('flex flex-col gap-3', fill && 'h-full min-h-0', className)}>
      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-2">
        {TOOL_ORDER.map((tool) => (
          <Button
            key={tool}
            type="button"
            size="sm"
            variant={state.tool === tool ? 'default' : 'outline'}
            onClick={() => dispatch({ type: 'SET_TOOL', tool })}
            aria-pressed={state.tool === tool}
          >
            {t(`tools.${tool}`)}
          </Button>
        ))}
        <div className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={!canUndo(state)}
          onClick={() => dispatch({ type: 'UNDO' })}
          aria-label={t('actions.undo')}
        >
          <Undo2 className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={!canRedo(state)}
          onClick={() => dispatch({ type: 'REDO' })}
          aria-label={t('actions.redo')}
        >
          <Redo2 className="size-4" aria-hidden />
        </Button>
        {showClear && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={state.elements.length === 0}
            onClick={() => dispatch({ type: 'CLEAR' })}
          >
            <Eraser className="size-4" aria-hidden />
            {t('actions.clear_all')}
          </Button>
        )}
        {showExport && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => {
              void handleExport();
            }}
          >
            <Download className="size-4" aria-hidden />
            {t('actions.download_image')}
          </Button>
        )}
      </div>

      {/* Tamaño del próximo elemento de punto (debajo de las herramientas, encima de Campo) */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{t('size_label')}</span>
        {SIZE_ORDER.map((size) => (
          <Button
            key={size}
            type="button"
            size="sm"
            variant={state.nextSize === size ? 'default' : 'outline'}
            onClick={() => dispatch({ type: 'SET_NEXT_SIZE', size })}
            aria-pressed={state.nextSize === size}
          >
            {t(`sizes.${size}`)}
          </Button>
        ))}
      </div>

      {/* Config del próximo elemento + selector de campo */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!lockFieldKind && (
          <>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{t('field.label')}</span>
            <Button
              type="button"
              size="sm"
              variant={state.field.kind === 'completo' ? 'default' : 'outline'}
              onClick={() => dispatch({ type: 'SET_FIELD_KIND', kind: 'completo' })}
            >
              {t('field.completo')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={state.field.kind === 'medio' ? 'default' : 'outline'}
              onClick={() => dispatch({ type: 'SET_FIELD_KIND', kind: 'medio' })}
            >
              {t('field.medio')}
            </Button>
          </>
        )}

        {state.tool === 'jugador' && (
          <>
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={state.nextRole}
              onChange={(e) => dispatch({ type: 'SET_NEXT_ROLE', role: e.target.value as PlayerRole })}
              aria-label={t('aria.role')}
            >
              {ROLE_ORDER.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </select>
            <Input
              className="h-9 w-28"
              placeholder={t('placeholders.label')}
              value={state.nextLabel}
              onChange={(e) => dispatch({ type: 'SET_NEXT_LABEL', label: e.target.value })}
              aria-label={t('aria.next_label')}
            />
          </>
        )}

        {state.tool === 'texto' && (
          <>
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Input
              className="h-9 w-40"
              placeholder={t('placeholders.text')}
              value={state.nextText}
              onChange={(e) => dispatch({ type: 'SET_NEXT_TEXT', text: e.target.value })}
              aria-label={t('aria.next_text')}
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
              aria-label={t('aria.arrow_style')}
            >
              {ARROW_STYLE_ORDER.map((style) => (
                <option key={style} value={style}>
                  {t(`arrow_styles.${style}`)}
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
              aria-label={t('aria.stroke')}
            >
              {STROKE_ORDER.map((stroke) => (
                <option key={stroke} value={stroke}>
                  {t(`strokes.${stroke}`)}
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
            aria-label={t('aria.fill')}
          >
            {FILL_VALUES.map((v) => (
              <option key={v} value={v}>
                {t(`fills.${v}`)}
              </option>
            ))}
          </select>
        )}

        {COLOR_TOOLS.has(state.tool) && (
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={state.nextColor ?? 'black'}
            onChange={(e) => dispatch({ type: 'SET_NEXT_COLOR', color: colorFromSelect(e.target.value) })}
            aria-label={t('color.aria')}
          >
            {COLOR_VALUES.map((v) => (
              <option key={v} value={v}>
                {t(`color.${v}`)}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Campo: renderer read-only + capa de interacción.
          F13.0: en `fill` el campo se escala-a-llenar (y rota como bloque rígido
          en apaisado) dentro de `fitRef`; si no, layout original intacto
          (wrapper con `display:contents` → cero impacto). */}
      <div
        ref={fitRef}
        className={cn(
          fill ? 'flex min-h-0 flex-1 items-center justify-center' : 'contents',
        )}
      >
        <div
          ref={rootRef}
          data-testid="pitch-field"
          className={cn(
            'relative touch-none overflow-hidden rounded-lg border',
            !fill && 'mx-auto w-full max-w-md',
            !fill && fieldAspectClass(state.field),
            state.tool !== 'select' && 'cursor-crosshair',
          )}
          style={fill ? fitStyle : undefined}
          onClick={handleBackgroundClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {renderField({ diagram, field: state.field })}

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
                ariaLabel={t('aria.element', { type: t(`tools.${el.type}`) })}
                rotated={rotated}
              />
            ) : (
              <DrawnHandle
                key={el.id}
                id={el.id}
                bbox={elementBBox(el)}
                selected={state.selectedId === el.id}
                onSelect={() => dispatch({ type: 'SELECT', id: el.id })}
                ariaLabel={t('aria.element', { type: t(`tools.${el.type}`) })}
                rotated={rotated}
              />
            ),
          )}
        </DndContext>
        </div>
      </div>

      {/* Editor inline del seleccionado */}
      {selected && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
          <span className="font-medium">{t(`tools.${selected.type}`)}</span>

          {selected.type === 'jugador' && (
            <Input
              key={selected.id}
              className="h-9 w-32"
              placeholder={t('placeholders.label')}
              defaultValue={selected.label ?? ''}
              onBlur={(e) => dispatch({ type: 'UPDATE_LABEL', id: selected.id, label: e.target.value })}
              aria-label={t('aria.label')}
            />
          )}
          {selected.type === 'texto' && (
            <Input
              key={selected.id}
              className="h-9 w-48"
              defaultValue={selected.text}
              onBlur={(e) => dispatch({ type: 'UPDATE_TEXT', id: selected.id, text: e.target.value })}
              aria-label={t('aria.text')}
            />
          )}
          {selected.type === 'flecha' && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.style}
              onChange={(e) => dispatch({ type: 'UPDATE_ARROW_STYLE', id: selected.id, style: e.target.value as ArrowStyle })}
              aria-label={t('aria.arrow_style')}
            >
              {ARROW_STYLE_ORDER.map((style) => (
                <option key={style} value={style}>
                  {t(`arrow_styles.${style}`)}
                </option>
              ))}
            </select>
          )}
          {(selected.type === 'linea' || selected.type === 'zona') && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.stroke ?? 'solid'}
              onChange={(e) => dispatch({ type: 'UPDATE_STROKE', id: selected.id, stroke: e.target.value as StrokeKind })}
              aria-label={t('aria.stroke')}
            >
              {STROKE_ORDER.map((stroke) => (
                <option key={stroke} value={stroke}>
                  {t(`strokes.${stroke}`)}
                </option>
              ))}
            </select>
          )}
          {selected.type === 'zona' && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.fill ?? 'none'}
              onChange={(e) => dispatch({ type: 'UPDATE_FILL', id: selected.id, fill: fillFromSelect(e.target.value) })}
              aria-label={t('aria.fill')}
            >
              {FILL_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`fills.${v}`)}
                </option>
              ))}
            </select>
          )}
          {(selected.type === 'flecha' || selected.type === 'linea') && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selected.color ?? 'black'}
              onChange={(e) => dispatch({ type: 'UPDATE_COLOR', id: selected.id, color: colorFromSelect(e.target.value) })}
              aria-label={t('color.aria')}
            >
              {COLOR_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`color.${v}`)}
                </option>
              ))}
            </select>
          )}
          {SIZE_CAPABLE.has(selected.type) && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={'size' in selected ? selected.size ?? 'md' : 'md'}
              onChange={(e) => dispatch({ type: 'UPDATE_SIZE', id: selected.id, size: e.target.value as ElementSize })}
              aria-label={t('aria.size')}
            >
              {SIZE_ORDER.map((size) => (
                <option key={size} value={size}>
                  {t(`sizes.${size}`)}
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
            {t('actions.delete')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * F11 — Editor de diagramas de un ejercicio. Wrapper fino de `<PitchBoard>` con
 * el campo por defecto (`<DiagramView>`). Es lo que usan el form de ejercicio
 * (11.6) y el harness `/dev-pitch-editor`.
 */
export function PitchEditor(props: {
  initialDiagram?: Diagram;
  onChange?: (diagram: Diagram) => void;
  showClear?: boolean;
  showExport?: boolean;
  /** F13.0 — el campo llena el alto disponible (fullscreen). */
  fill?: boolean;
  /** F13.0 — rota la unidad-campo 90° (apaisado). */
  fillRotationDeg?: 0 | 90;
  className?: string;
}) {
  return <PitchBoard {...props} />;
}

/** Handle de punto: centrado en (x,y); el transform de dnd va en el botón para
 *  no pisar el translate de centrado. Transparente salvo selección. */
/** F13.0 — transform del handle durante el drag. Si la unidad-campo está rotada
 *  90° (fullscreen apaisado), el delta de dnd (px de pantalla) se re-expresa en el
 *  marco local del campo rotado para que el preview siga al dedo. */
function handleDragTransform(
  transform: Transform | null,
  rotated: boolean,
): string | undefined {
  if (!transform) return undefined;
  if (rotated) return `translate3d(${transform.y}px, ${-transform.x}px, 0)`;
  return CSS.Translate.toString(transform);
}

function PointHandle({
  id,
  xPct,
  yPct,
  selected,
  onSelect,
  ariaLabel,
  rotated = false,
}: {
  id: string;
  xPct: number;
  yPct: number;
  selected: boolean;
  onSelect: () => void;
  ariaLabel: string;
  rotated?: boolean;
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
        style={{ transform: handleDragTransform(transform, rotated) }}
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
        aria-label={ariaLabel}
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
  ariaLabel,
  rotated = false,
}: {
  id: string;
  bbox: { x: number; y: number; w: number; h: number };
  selected: boolean;
  onSelect: () => void;
  ariaLabel: string;
  rotated?: boolean;
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
        transform: handleDragTransform(transform, rotated),
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
      aria-label={ariaLabel}
      {...listeners}
      {...attributes}
    />
  );
}
