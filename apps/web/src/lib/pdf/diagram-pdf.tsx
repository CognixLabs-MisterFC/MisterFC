/**
 * A2 (tanda 3) — Renderer @react-pdf del DIAGRAMA del campo. Gemelo de
 * `DiagramView` (web): porta `FieldMarkings` + `renderElement` a primitivas de
 * `@react-pdf/renderer` (`Svg`/`Line`/`Circle`/`Rect`/`Polygon`/`Path`/`Text`).
 *
 * REUTILIZABLE (C2 informe, D4): recibe un `Diagram` o `Scene` (frame de una
 * jugada) + su `field`, sin acoplarse a sesiones. Mismo viewBox y mismas
 * proporciones que la web (completo 100×150, medio 100×75) → dibujo equivalente.
 *
 * Diferencias forzadas por @react-pdf (no rompe la fidelidad):
 *   · No hay `<marker>` → las puntas de flecha/cota se dibujan como `Polygon`.
 *   · No cascada `currentColor`/rgba → colores fijos + `strokeOpacity`/`fillOpacity`.
 *   · `transform="rotate(...)"` se aplica envolviendo en `<G>` (portería).
 * La orientación `horizontal` degrada a completo+vertical, igual que la web.
 */

import { Svg, G, Line, Circle, Rect, Polygon, Path, Text } from '@react-pdf/renderer';
import {
  smoothPathD,
  type Diagram,
  type Scene,
  type DiagramElement,
  type DiagramField,
  type ElementSize,
  type StrokeColor,
  type SceneElement,
} from '@misterfc/core';

// Dimensiones de lienzo por kind (unidades de viewBox), idénticas a DiagramView.
const CANVAS = {
  completo: { w: 100, h: 150 },
  medio: { w: 100, h: 75 },
} as const;

const ROLE_FILL: Record<string, string> = {
  atacante: '#dc2626',
  defensor: '#eab308',
  comodin: '#2563eb',
  portero: '#111827',
};

// Semántica de flecha (`style`) → trazo visual (mismo mapeo que la web).
const ARROW_DASH: Record<string, string | undefined> = {
  pase: undefined,
  desmarque: '3 2',
  conduccion: '1 1.4',
};

const INK = '#1f2937';
const STROKE_COLOR_HEX: Record<StrokeColor, string> = { blue: '#2563eb', red: '#dc2626' };
const strokeColorOf = (c: StrokeColor | undefined): string => (c ? STROKE_COLOR_HEX[c] : INK);

const SIZE_SCALE: Record<ElementSize, number> = { sm: 0.7, md: 1, lg: 1.4 };
const scaleOf = (size: ElementSize | undefined): number => SIZE_SCALE[size ?? 'md'];

/** Punta de flecha (triángulo) en (x2,y2) orientada según (x1,y1)→(x2,y2).
 *  Sustituye al `<marker>` SVG (no soportado por @react-pdf). */
function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  key: string,
): React.ReactElement {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = 2.4;
  const wid = 1.5;
  const bx = x2 - len * Math.cos(ang);
  const by = y2 - len * Math.sin(ang);
  const px = Math.sin(ang) * wid;
  const py = -Math.cos(ang) * wid;
  const points = `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`;
  return <Polygon key={key} points={points} fill={color} />;
}

/** Pinta UN elemento en unidades de viewBox ya mapeadas (port de `renderElement`). */
function renderElement(
  el: DiagramElement,
  mx: (v: number) => number,
  my: (v: number) => number,
): React.ReactNode {
  switch (el.type) {
    case 'jugador': {
      const cx = mx(el.x_pct);
      const cy = my(el.y_pct);
      const s = scaleOf(el.size);
      const nodes: React.ReactElement[] = [
        <Circle
          key="c"
          cx={cx}
          cy={cy}
          r={2.55 * s}
          fill={ROLE_FILL[el.role]}
          stroke="#ffffff"
          strokeWidth={0.5}
        />,
      ];
      if (el.label) {
        nodes.push(
          <Text key="t" x={cx} y={cy + 6.2 * s} style={{ fontSize: 3 * s }} textAnchor="middle" fill={INK}>
            {el.label}
          </Text>,
        );
      }
      return nodes;
    }
    case 'balon': {
      const s = scaleOf(el.size);
      return (
        <Circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={1.8 * s} fill="#ffffff" stroke="#111111" strokeWidth={0.4} />
      );
    }
    case 'cono': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      const s = scaleOf(el.size);
      return (
        <Polygon
          points={`${x},${y - 2.6 * s} ${x - 2.4 * s},${y + 2 * s} ${x + 2.4 * s},${y + 2 * s}`}
          fill="#f59e0b"
          stroke="#b45309"
          strokeWidth={0.3}
        />
      );
    }
    case 'aro': {
      const s = scaleOf(el.size);
      return (
        <Circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={2.8 * s} fill="none" stroke="#f59e0b" strokeWidth={0.9} />
      );
    }
    case 'gol_conduccion': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      const h = 1.6 * scaleOf(el.size);
      return <Rect x={x - h} y={y - h} width={h * 2} height={h * 2} fill="#2563eb" />;
    }
    case 'porteria':
    case 'miniporteria': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      const s = scaleOf(el.size);
      const w = (el.type === 'porteria' ? 12 : 7) * s;
      const hh = 0.9 * s;
      const rect = <Rect x={x - w / 2} y={y - hh} width={w} height={hh * 2} fill="#111827" />;
      return el.rotation ? <G transform={`rotate(${el.rotation} ${x} ${y})`}>{rect}</G> : rect;
    }
    case 'texto':
      return (
        <Text
          x={mx(el.x_pct)}
          y={my(el.y_pct)}
          style={{ fontSize: 4 * scaleOf(el.size), fontWeight: 'bold' }}
          textAnchor="middle"
          fill={INK}
        >
          {el.text}
        </Text>
      );
    case 'flecha': {
      const x1 = mx(el.from.x_pct);
      const y1 = my(el.from.y_pct);
      const x2 = mx(el.to.x_pct);
      const y2 = my(el.to.y_pct);
      const color = strokeColorOf(el.color);
      return [
        <Line
          key="l"
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={color}
          strokeWidth={0.8}
          strokeDasharray={ARROW_DASH[el.style]}
        />,
        arrowHead(x1, y1, x2, y2, color, 'h'),
      ];
    }
    case 'linea': {
      const d = smoothPathD(el.points.map((p) => ({ x: mx(p.x_pct), y: my(p.y_pct) })));
      return (
        <Path
          d={d}
          fill="none"
          stroke={strokeColorOf(el.color)}
          strokeWidth={0.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={el.stroke === 'dashed' ? '3 2' : undefined}
        />
      );
    }
    case 'zona': {
      const dashed = el.stroke === 'dashed';
      const green = el.fill === 'green';
      return (
        <Rect
          x={mx(el.x_pct)}
          y={my(el.y_pct)}
          width={mx(el.w_pct)}
          height={my(el.h_pct)}
          fill={green ? '#22c55e' : 'none'}
          fillOpacity={green ? 0.25 : undefined}
          stroke={dashed ? '#dc2626' : INK}
          strokeWidth={0.7}
          strokeDasharray={dashed ? '3 2' : undefined}
        />
      );
    }
    case 'cota': {
      const x1 = mx(el.from.x_pct);
      const y1 = my(el.from.y_pct);
      const x2 = mx(el.to.x_pct);
      const y2 = my(el.to.y_pct);
      return [
        <Line key="l" x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={0.5} />,
        arrowHead(x2, y2, x1, y1, INK, 'h1'),
        arrowHead(x1, y1, x2, y2, INK, 'h2'),
        <Text
          key="t"
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - 1.5}
          style={{ fontSize: 3 }}
          textAnchor="middle"
          fill={INK}
        >
          {el.label}
        </Text>,
      ];
    }
    default:
      return null;
  }
}

/** Marcas del campo (port de `FieldMarkings`), dentro del mismo Svg. EXPORTADO para
 *  reutilizarlo en otros mini-campos del PDF (p.ej. el campo de posición, C2). */
export function fieldMarkings(kind: 'completo' | 'medio'): React.ReactElement {
  const line = { stroke: '#ffffff', strokeOpacity: 0.5, strokeWidth: 0.6 } as const;
  if (kind === 'medio') {
    return (
      <G>
        <Rect x={0} y={0} width={100} height={75} fill="#15803d" />
        <Line x1={3} y1={3} x2={97} y2={3} {...line} />
        <Line x1={3} y1={3} x2={3} y2={75} {...line} />
        <Line x1={97} y1={3} x2={97} y2={75} {...line} />
        <Line x1={3} y1={75} x2={97} y2={75} {...line} />
        <Circle cx={50} cy={75} r={11} fill="none" {...line} />
        <Rect x={22} y={3} width={56} height={24} fill="none" {...line} />
      </G>
    );
  }
  return (
    <G>
      <Rect x={0} y={0} width={100} height={150} fill="#15803d" />
      <Rect x={3} y={3} width={94} height={144} fill="none" {...line} />
      <Line x1={3} y1={75} x2={97} y2={75} {...line} />
      <Circle cx={50} cy={75} r={11} fill="none" {...line} />
      <Rect x={22} y={123} width={56} height={24} fill="none" {...line} />
      <Rect x={22} y={3} width={56} height={24} fill="none" {...line} />
    </G>
  );
}

/** ¿Hay algo que dibujar? (sin elementos = se omite el bloque desde fuera). */
export function hasDrawableDiagram(d: Diagram | Scene | null | undefined): boolean {
  return !!d && Array.isArray(d.elements) && d.elements.length > 0;
}

/**
 * Dibujo del campo + elementos en @react-pdf. `width` en pt; la altura se deriva
 * del aspect del lienzo (completo 3/2, medio 3/4). La orientación `horizontal`
 * degrada a completo+vertical (igual que la web).
 */
export function DiagramPdf({
  diagram,
  width = 130,
}: {
  diagram: Diagram | Scene;
  width?: number;
}): React.ReactElement {
  const field = diagram.field as DiagramField;
  const kind: keyof typeof CANVAS = field.orientation !== 'vertical' ? 'completo' : field.kind;
  const { w, h } = CANVAS[kind];
  const mx = (v: number) => (v / 100) * w;
  const my = (v: number) => (v / 100) * h;
  const height = (width * h) / w;

  return (
    <Svg viewBox={`0 0 ${w} ${h}`} width={width} height={height}>
      {fieldMarkings(kind)}
      {(diagram.elements as SceneElement[]).map((el) => (
        <G key={el.id} opacity={el.opacity}>
          {renderElement(el, mx, my)}
        </G>
      ))}
    </Svg>
  );
}
