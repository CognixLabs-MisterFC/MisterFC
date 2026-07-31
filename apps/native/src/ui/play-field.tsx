import { useWindowDimensions, View } from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import {
  smoothPathD,
  type Scene,
  type SceneElement,
  type DiagramField,
  type ElementSize,
  type StrokeColor,
} from '@misterfc/core';

/**
 * O2-5 D2 — Renderer nativo de una ESCENA de jugada (react-native-svg). Port del
 * `DiagramView` + `FieldMarkings` web: mismas coords (%→viewBox), mismos glifos por
 * tipo de elemento. La escena la calcula core (`sceneAtTime`); aquí solo se pinta.
 * Sin DOM: SVG vectorial (campo, jugadores, flechas, líneas, zonas, texto).
 */

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
const INK = '#1f2937';
const STROKE_COLOR_HEX: Record<StrokeColor, string> = { blue: '#2563eb', red: '#dc2626' };
const strokeColorOf = (c: StrokeColor | undefined): string => (c ? STROKE_COLOR_HEX[c] : INK);
const ARROW_DASH: Record<string, string | undefined> = {
  pase: undefined,
  desmarque: '3 2',
  conduccion: '1 1.4',
};
const SIZE_SCALE: Record<ElementSize, number> = { sm: 0.7, md: 1, lg: 1.4 };
const scaleOf = (size: ElementSize | undefined): number => SIZE_SCALE[size ?? 'md'];

/** Degrada `horizontal` (aún no soportado) a completo+vertical, como el web. */
function fieldKind(field: DiagramField): keyof typeof CANVAS {
  return field.orientation !== 'vertical' ? 'completo' : field.kind;
}

/** Triángulo de punta de flecha en (x2,y2) orientado desde (x1,y1). */
function arrowHead(x1: number, y1: number, x2: number, y2: number, color: string): React.ReactNode {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = 2.4;
  const wing = 0.5; // rad
  const p1x = x2 - len * Math.cos(ang - wing);
  const p1y = y2 - len * Math.sin(ang - wing);
  const p2x = x2 - len * Math.cos(ang + wing);
  const p2y = y2 - len * Math.sin(ang + wing);
  return <Polygon points={`${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`} fill={color} />;
}

function renderElement(
  el: SceneElement,
  mx: (v: number) => number,
  my: (v: number) => number,
): React.ReactNode {
  switch (el.type) {
    case 'jugador': {
      const cx = mx(el.x_pct);
      const cy = my(el.y_pct);
      const s = scaleOf(el.size);
      return (
        <>
          <Circle cx={cx} cy={cy} r={2.55 * s} fill={ROLE_FILL[el.role]} stroke="#fff" strokeWidth={0.5} />
          {el.label ? (
            <SvgText x={cx} y={cy + 6.2 * s} fontSize={3 * s} textAnchor="middle" fill={INK}>
              {el.label}
            </SvgText>
          ) : null}
        </>
      );
    }
    case 'balon': {
      const s = scaleOf(el.size);
      return <Circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={1.8 * s} fill="#fff" stroke="#111" strokeWidth={0.4} />;
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
      return <Circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={2.8 * s} fill="none" stroke="#f59e0b" strokeWidth={0.9} />;
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
      return (
        <Rect
          x={x - w / 2}
          y={y - hh}
          width={w}
          height={hh * 2}
          fill="#111827"
          origin={`${x}, ${y}`}
          rotation={el.rotation ?? 0}
        />
      );
    }
    case 'texto':
      return (
        <SvgText
          x={mx(el.x_pct)}
          y={my(el.y_pct)}
          fontSize={4 * scaleOf(el.size)}
          fontWeight="bold"
          textAnchor="middle"
          fill={INK}
        >
          {el.text}
        </SvgText>
      );
    case 'flecha': {
      const x1 = mx(el.from.x_pct);
      const y1 = my(el.from.y_pct);
      const x2 = mx(el.to.x_pct);
      const y2 = my(el.to.y_pct);
      const color = strokeColorOf(el.color);
      return (
        <>
          <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={0.8} strokeDasharray={ARROW_DASH[el.style]} />
          {arrowHead(x1, y1, x2, y2, color)}
        </>
      );
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
      const fill = el.fill === 'green' ? '#22c55e' : 'none';
      return (
        <Rect
          x={mx(el.x_pct)}
          y={my(el.y_pct)}
          width={mx(el.w_pct)}
          height={my(el.h_pct)}
          fill={fill}
          fillOpacity={el.fill === 'green' ? 0.25 : undefined}
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
      return (
        <>
          <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={0.5} />
          {arrowHead(x2, y2, x1, y1, INK)}
          {arrowHead(x1, y1, x2, y2, INK)}
          <SvgText x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 1.5} fontSize={3} textAnchor="middle" fill={INK}>
            {el.label}
          </SvgText>
        </>
      );
    }
    default:
      return null;
  }
}

/** Marcas del campo (rect verde + líneas), port de FieldMarkings. */
function FieldMarkings({ kind }: { kind: keyof typeof CANVAS }) {
  const line = 'rgba(255,255,255,0.5)';
  if (kind === 'medio') {
    return (
      <>
        <Rect x={0} y={0} width={100} height={75} fill="#15803d" />
        <G fill="none" stroke={line} strokeWidth={0.6}>
          <Line x1={3} y1={3} x2={97} y2={3} />
          <Line x1={3} y1={3} x2={3} y2={75} />
          <Line x1={97} y1={3} x2={97} y2={75} />
          <Line x1={3} y1={75} x2={97} y2={75} />
          <Circle cx={50} cy={75} r={11} />
          <Rect x={22} y={3} width={56} height={24} />
        </G>
      </>
    );
  }
  return (
    <>
      <Rect x={0} y={0} width={100} height={150} fill="#15803d" />
      <G fill="none" stroke={line} strokeWidth={0.6}>
        <Rect x={3} y={3} width={94} height={144} />
        <Line x1={3} y1={75} x2={97} y2={75} />
        <Circle cx={50} cy={75} r={11} />
        <Rect x={22} y={123} width={56} height={24} />
        <Rect x={22} y={3} width={56} height={24} />
      </G>
    </>
  );
}

export function PlayField({ scene }: { scene: Scene }) {
  const { width: winW } = useWindowDimensions();
  const kind = fieldKind(scene.field);
  const { w, h } = CANVAS[kind];
  const width = Math.min(winW - 32, 460);
  const height = (width * h) / w;
  const mx = (v: number) => (v / 100) * w;
  const my = (v: number) => (v / 100) * h;

  return (
    <View style={{ width, height, alignSelf: 'center', borderRadius: 12, overflow: 'hidden' }}>
      <Svg width={width} height={height} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <FieldMarkings kind={kind} />
        {scene.elements.map((el) => (
          <G key={el.id} opacity={el.opacity}>
            {renderElement(el, mx, my)}
          </G>
        ))}
      </Svg>
    </View>
  );
}
