/**
 * C2 — Mini-campo con la POSICIÓN del jugador en @react-pdf. Gemelo del
 * `PositionField` web (ficha): campo completo vertical (área propia abajo: portero
 * abajo → delantero arriba) con la posición PRINCIPAL sólida y la(s) SECUNDARIA(S)
 * más tenues. Reusa `fieldMarkings('completo')` (las marcas del campo de A2).
 */

import { Svg, Circle } from '@react-pdf/renderer';
import type { PlayerPosition } from '@misterfc/core';
import { fieldMarkings } from './diagram-pdf';

const GREEN = '#10B981'; // misterfc-green

// Mismas coordenadas que el componente web (viewBox 0..100 × 0..150, atacando arriba).
const POS_XY: Record<PlayerPosition, { x: number; y: number }> = {
  goalkeeper: { x: 50, y: 140 },
  defender: { x: 50, y: 110 },
  midfielder: { x: 50, y: 75 },
  forward: { x: 50, y: 38 },
};

function Dot({ pos, primary }: { pos: PlayerPosition; primary: boolean }) {
  const { x, y } = POS_XY[pos];
  // Principal: punto sólido + anillo; secundaria: relleno y anillo atenuados.
  return (
    <>
      <Circle cx={x} cy={y} r={primary ? 6 : 4.5} fill={GREEN} fillOpacity={primary ? 1 : 0.4} />
      <Circle
        cx={x}
        cy={y}
        r={primary ? 8 : 6}
        fill="none"
        stroke={GREEN}
        strokeOpacity={primary ? 0.4 : 0.2}
        strokeWidth={1.5}
      />
    </>
  );
}

/** Devuelve null (omitir limpio) si no hay ninguna posición que pintar. */
export function PositionFieldPdf({
  primary,
  secondary = [],
  width = 70,
}: {
  primary: PlayerPosition | null;
  secondary?: string[];
  width?: number;
}): React.ReactElement | null {
  const secondaryPos = secondary.filter(
    (s): s is PlayerPosition => s in POS_XY && s !== primary,
  );
  if (!primary && secondaryPos.length === 0) return null;

  const height = width * 1.5; // viewBox 100×150
  return (
    <Svg viewBox="0 0 100 150" width={width} height={height}>
      {fieldMarkings('completo')}
      {secondaryPos.map((p) => (
        <Dot key={p} pos={p} primary={false} />
      ))}
      {primary ? <Dot pos={primary} primary /> : null}
    </Svg>
  );
}
