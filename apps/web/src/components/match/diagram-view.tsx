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
import type { Diagram, DiagramElement } from '@misterfc/core';
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
      return (
        <>
          <circle cx={cx} cy={cy} r={3.4} fill={ROLE_FILL[el.role]} stroke="#fff" strokeWidth={0.5} />
          {el.label ? (
            <text x={cx} y={cy + 6.2} fontSize={3} textAnchor="middle" fill={INK}>
              {el.label}
            </text>
          ) : null}
        </>
      );
    }
    case 'balon':
      return <circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={1.8} fill="#fff" stroke="#111" strokeWidth={0.4} />;
    case 'cono': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      return (
        <polygon
          points={`${x},${y - 2.6} ${x - 2.4},${y + 2} ${x + 2.4},${y + 2}`}
          fill="#f59e0b"
          stroke="#b45309"
          strokeWidth={0.3}
        />
      );
    }
    case 'aro':
      return (
        <circle cx={mx(el.x_pct)} cy={my(el.y_pct)} r={2.8} fill="none" stroke="#f59e0b" strokeWidth={0.9} />
      );
    case 'gol_conduccion': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      return <rect x={x - 1.6} y={y - 1.6} width={3.2} height={3.2} fill="#2563eb" />;
    }
    case 'porteria':
    case 'miniporteria': {
      const x = mx(el.x_pct);
      const y = my(el.y_pct);
      const w = el.type === 'porteria' ? 12 : 7;
      const transform = el.rotation ? `rotate(${el.rotation} ${x} ${y})` : undefined;
      return <rect x={x - w / 2} y={y - 0.9} width={w} height={1.8} fill="#111827" transform={transform} />;
    }
    case 'texto':
      return (
        <text
          x={mx(el.x_pct)}
          y={my(el.y_pct)}
          fontSize={4}
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
          stroke={INK}
          strokeWidth={0.8}
          strokeDasharray={ARROW_DASH[el.style]}
          markerEnd="url(#diagram-arrowhead)"
        />
      );
    case 'linea': {
      const pts = el.points.map((p) => `${mx(p.x_pct)},${my(p.y_pct)}`).join(' ');
      return (
        <polyline
          points={pts}
          fill="none"
          stroke={INK}
          strokeWidth={0.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={el.stroke === 'dashed' ? '3 2' : undefined}
        />
      );
    }
    case 'zona': {
      const dashed = el.stroke === 'dashed';
      return (
        <rect
          x={mx(el.x_pct)}
          y={my(el.y_pct)}
          width={mx(el.w_pct)}
          height={my(el.h_pct)}
          fill="none"
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
}: {
  diagram: Diagram;
  className?: string;
  /** Rellena el contenedor padre (absolute inset-0) en vez de imponer su propio
   *  aspect-ratio/ancho. Lo usa el editor (11.5b) para superponer la capa de
   *  interacción sobre el MISMO lienzo sin duplicar el pintado. El padre debe
   *  fijar el aspect-ratio del kind. */
  fill?: boolean;
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
      <FieldMarkings kind={kind} />
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
        <defs>
          <marker
            id="diagram-arrowhead"
            markerUnits="userSpaceOnUse"
            markerWidth={4}
            markerHeight={4}
            refX={3}
            refY={2}
            orient="auto"
          >
            <path d="M0,0 L4,2 L0,4 z" fill={INK} />
          </marker>
        </defs>
        {diagram.elements.map((el) => (
          <g key={el.id}>{renderElement(el, mx, my)}</g>
        ))}
      </svg>
    </div>
  );
}
