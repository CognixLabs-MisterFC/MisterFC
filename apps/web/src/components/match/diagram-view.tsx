/**
 * F11.5a — Renderer READ-ONLY del diagrama de un ejercicio.
 *
 * Presentacional PURO: recibe un `Diagram` (contrato de @misterfc/core, 11.0) y lo
 * pinta sobre `<FieldMarkings>` (F6). Sin estado, sin edición, sin dnd, sin BD. Es
 * el renderer COMPARTIDO: la ficha (11.4) lo usa tal cual y el editor (11.5b) le
 * añadirá interacción encima.
 *
 * Coordenadas: `x_pct`/`y_pct` (y `w_pct`/`h_pct`) son % 0–100 en ambos ejes. El
 * mapeo a unidades de la viewBox está PARAMETRIZADO por las dimensiones del lienzo
 * (`x = x_pct/100 · canvasW`, `y = y_pct/100 · canvasH`): completo = 100×150,
 * medio = 100×75. Las MISMAS dimensiones se pasan a `<FieldMarkings>` y al mapeo,
 * para que marcas y elementos cuadren (en medio, y_pct 0–100 → 0–75).
 *
 * Campo: `<FieldMarkings>` ofrece COMPLETO + VERTICAL y MEDIO + VERTICAL ("atacando
 * arriba"). La orientación `horizontal` (ambos kinds) todavía DEGRADA a
 * completo+vertical (el aviso lo muestra el harness vía `isDegradedField`).
 *
 * Mapeo semántica→visual de la flecha: el renderer es DUEÑO del mapeo (la spec deja
 * el aspecto a discreción). Está en `ARROW_DASH`, fácil de ajustar.
 */

import type { ReactNode } from 'react';
import type { Diagram, DiagramElement, ElementSize, StrokeColor, Scene, SceneElement } from '@misterfc/core';
import { smoothPathD } from '@misterfc/core';
import { cn } from '@/lib/utils';
import { FieldMarkings } from './field-markings';

// Dimensiones de lienzo por kind (unidades de viewBox). El mapeo de coords está
// parametrizado por estas dimensiones (ver `mx`/`my`) y se selecciona por
// field.kind, sin lógica de mapeo distinta por campo.
const CANVAS = {
  completo: { w: 100, h: 150 },
  medio: { w: 100, h: 75 },
} as const;

// aspect-ratio del contenedor por kind (= w/h del lienzo): 2/3 completo, 4/3 medio.
const ASPECT: Record<keyof typeof CANVAS, string> = {
  completo: 'aspect-[2/3]',
  medio: 'aspect-[4/3]',
};

/** ¿El lienzo pedido se está degradando a completo+vertical? (lo usa el harness).
 *  Soportados: completo+vertical y medio+vertical. Degrada cualquier `horizontal`. */
export function isDegradedField(field: Diagram['field']): boolean {
  return field.orientation !== 'vertical';
}

/** Clase tailwind de aspect-ratio del lienzo para un `field` (tras degradar).
 *  El editor (11.5b) la usa para fijar el contenedor que envuelve a
 *  `<DiagramView fill>` + la capa de interacción. */
export function fieldAspectClass(field: Diagram['field']): string {
  return ASPECT[isDegradedField(field) ? 'completo' : field.kind];
}

// Colores de jugador por rol (leyenda pág. 3). Fácil de ajustar.
const ROLE_FILL: Record<string, string> = {
  atacante: '#dc2626', // rojo
  defensor: '#eab308', // amarillo
  comodin: '#2563eb', // azul
  portero: '#111827', // negro
};

// Mapeo semántica de flecha (`style`) → trazo visual. El renderer manda.
const ARROW_DASH: Record<string, string | undefined> = {
  pase: undefined, // sólida
  desmarque: '3 2', // discontinua
  conduccion: '1 1.4', // punteada (distinta de desmarque)
};

const INK = '#1f2937';

// F11B.0 — color de trazo opcional (flecha/linea). Ausente = INK (negro).
const STROKE_COLOR_HEX: Record<StrokeColor, string> = { blue: '#2563eb', red: '#dc2626' };
const strokeColorOf = (c: StrokeColor | undefined): string => (c ? STROKE_COLOR_HEX[c] : INK);
/** Id del marcador de punta de flecha por color (uno por color en <defs>). */
const arrowheadId = (c: StrokeColor | undefined): string =>
  c ? `diagram-arrowhead-${c}` : 'diagram-arrowhead';

// Factor de escala del glifo por `size` (md = tamaño actual). Lo aplica el
// renderer a los elementos de PUNTO; en `texto` escala la fuente.
const SIZE_SCALE: Record<ElementSize, number> = { sm: 0.7, md: 1, lg: 1.4 };
const scaleOf = (size: ElementSize | undefined): number => SIZE_SCALE[size ?? 'md'];

/** Pinta UN elemento en unidades de viewBox ya mapeadas. No es un componente
 *  (se llama como función) → no infringe la regla "componentes en render". */
function renderElement(
  el: DiagramElement,
  mx: (v: number) => number,
  my: (v: number) => number,
): ReactNode {
  switch (el.type) {
    case 'jugador': {
      const cx = mx(el.x_pct);
      const cy = my(el.y_pct);
      const s = scaleOf(el.size);
      // Radio base reducido un 25% (2.55 = 3.4 × 0.75); sm/lg escalan desde aquí.
      return (
        <>
          <circle cx={cx} cy={cy} r={2.55 * s} fill={ROLE_FILL[el.role]} stroke="#fff" strokeWidth={0.5} />
          {el.label ? (
            <text x={cx} y={cy + 6.2 * s} fontSize={3 * s} textAnchor="middle" fill={INK}>
              {el.label}
            </text>
          ) : null}
        </>
      );
    }
    case 'balon': {
      const s = scaleOf(el.size);
      return <circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={1.8 * s} fill="#fff" stroke="#111" strokeWidth={0.4} />;
    }
    case 'cono': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      const s = scaleOf(el.size);
      return (
        <polygon
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
        <circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={2.8 * s} fill="none" stroke="#f59e0b" strokeWidth={0.9} />
      );
    }
    case 'gol_conduccion': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      const h = 1.6 * scaleOf(el.size);
      return <rect x={x - h} y={y - h} width={h * 2} height={h * 2} fill="#2563eb" />;
    }
    case 'porteria':
    case 'miniporteria': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      const s = scaleOf(el.size);
      const w = (el.type === 'porteria' ? 12 : 7) * s;
      const hh = 0.9 * s;
      const transform = el.rotation ? `rotate(${el.rotation} ${x} ${y})` : undefined;
      return <rect x={x - w / 2} y={y - hh} width={w} height={hh * 2} fill="#111827" transform={transform} />;
    }
    case 'texto':
      return (
        <text
          x={mx(el.x_pct)}
          y={my(el.y_pct)}
          fontSize={4 * scaleOf(el.size)}
          fontWeight="bold"
          textAnchor="middle"
          fill={INK}
        >
          {el.text}
        </text>
      );
    case 'flecha':
      return (
        <line
          x1={mx(el.from.x_pct)}
          y1={my(el.from.y_pct)}
          x2={mx(el.to.x_pct)}
          y2={my(el.to.y_pct)}
          stroke={strokeColorOf(el.color)}
          strokeWidth={0.8}
          strokeDasharray={ARROW_DASH[el.style]}
          markerEnd={`url(#${arrowheadId(el.color)})`}
        />
      );
    case 'linea': {
      // Generador COMPARTIDO: suaviza el dibujo libre (≥3 puntos) con curvas y
      // deja recta la línea recta (2 puntos). Mismo `d` que pinta el editor.
      const d = smoothPathD(el.points.map((p) => ({ x: mx(p.x_pct), y: my(p.y_pct) })));
      return (
        <path
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
      // Relleno opcional SEMI-TRANSPARENTE: deja ver jugadores/balón encima. Solo
      // 'green' por ahora; ausente = sin relleno (contorno actual).
      const fill = el.fill === 'green' ? '#22c55e' : 'none';
      return (
        <rect
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
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={INK}
            strokeWidth={0.5}
            markerStart="url(#diagram-arrowhead)"
            markerEnd="url(#diagram-arrowhead)"
          />
          <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 1.5} fontSize={3} textAnchor="middle" fill={INK}>
            {el.label}
          </text>
        </>
      );
    }
    default:
      return null;
  }
}

export function DiagramView({
  diagram,
  className,
  fill = false,
  showField = true,
}: {
  /** Acepta un `Diagram` (escena estática F11) o una `Scene` (salida de
   *  `sceneAtTime`, F13.3): un `Diagram` es asignable a `Scene` (la `opacity` por
   *  elemento es opcional), así que los usos actuales no cambian. */
  diagram: Diagram | Scene;
  className?: string;
  /** Rellena el contenedor padre (absolute inset-0) en vez de imponer su propio
   *  aspect-ratio/ancho. Lo usa el editor (11.5b) para superponer la capa de
   *  interacción sobre el MISMO lienzo sin duplicar el pintado. El padre debe
   *  fijar el aspect-ratio del kind. */
  fill?: boolean;
  /** Si false, NO pinta `<FieldMarkings>`: solo los elementos (SVG transparente).
   *  Lo usa F11B.2 para superponer los dibujos sobre OTRO campo (el once real de
   *  `<MatchFieldEditor>`) sin duplicar las marcas del campo. */
  showField?: boolean;
}) {
  // Degradación: la orientación `horizontal` (ambos kinds) cae a completo+vertical
  // (hueco conocido de FieldMarkings — ver cabecera; el aviso lo da el harness).
  const kind: keyof typeof CANVAS = isDegradedField(diagram.field) ? 'completo' : diagram.field.kind;
  const { w, h } = CANVAS[kind];
  const mx = (v: number) => (v / 100) * w;
  const my = (v: number) => (v / 100) * h;

  return (
    <div
      className={cn(
        fill
          ? 'absolute inset-0 size-full overflow-hidden'
          : cn('relative mx-auto w-full max-w-md overflow-hidden rounded-lg', ASPECT[kind]),
        className,
      )}
    >
      {showField && <FieldMarkings kind={kind} />}
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
        <defs>
          {/* Un marcador por color de trazo (negro por defecto + blue/red). El
              `fill` del marcador debe casar con el color de la flecha (los
              marcadores no heredan el stroke de la línea de forma fiable). */}
          {([undefined, 'blue', 'red'] as const).map((c) => (
            <marker
              key={c ?? 'default'}
              id={arrowheadId(c)}
              markerUnits="userSpaceOnUse"
              markerWidth={4}
              markerHeight={4}
              refX={3}
              refY={2}
              orient="auto"
            >
              <path d="M0,0 L4,2 L0,4 z" fill={strokeColorOf(c)} />
            </marker>
          ))}
        </defs>
        {/* `opacity` por elemento (fade de aparición/desaparición de la Scene, F13.3).
            Ausente = 1 (los Diagram estáticos no la traen → sin cambios). */}
        {(diagram.elements as SceneElement[]).map((el) => (
          <g key={el.id} opacity={el.opacity}>
            {renderElement(el, mx, my)}
          </g>
        ))}
      </svg>
    </div>
  );
}
