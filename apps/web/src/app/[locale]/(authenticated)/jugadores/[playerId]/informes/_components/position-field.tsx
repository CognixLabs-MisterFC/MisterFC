/**
 * F13.10 — Mini-campo SVG con la posición del jugador pintada (reusa
 * FieldMarkings). Posición principal sólida; secundarias más tenues. Campo
 * completo vertical (área propia abajo): portero abajo → delantero arriba.
 */

import type { PlayerPosition } from '@misterfc/core';
import { FieldMarkings } from '@/components/match/field-markings';
import { cn } from '@/lib/utils';

// Coordenadas (sobre viewBox 0..100 x 0..150, atacando hacia arriba) por línea.
const POS_XY: Record<PlayerPosition, { x: number; y: number }> = {
  goalkeeper: { x: 50, y: 140 },
  defender: { x: 50, y: 110 },
  midfielder: { x: 50, y: 75 },
  forward: { x: 50, y: 38 },
};

function Dot({
  pos,
  primary,
}: {
  pos: PlayerPosition;
  primary: boolean;
}) {
  const { x, y } = POS_XY[pos];
  return (
    <span
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2',
        primary
          ? 'size-4 bg-misterfc-green ring-misterfc-green/40'
          : 'size-3 bg-misterfc-green/40 ring-misterfc-green/20',
      )}
      style={{ left: `${x}%`, top: `${(y / 150) * 100}%` }}
      aria-hidden
    />
  );
}

export function PositionField({
  primary,
  secondary = [],
}: {
  primary: PlayerPosition | null;
  secondary?: string[];
}) {
  const secondaryPos = secondary.filter(
    (s): s is PlayerPosition => s in POS_XY && s !== primary,
  );
  return (
    <div className="relative mx-auto aspect-[2/3] w-28 overflow-hidden rounded-md border border-border bg-emerald-950/30">
      <FieldMarkings kind="completo" className="text-emerald-500/30" />
      {secondaryPos.map((p) => (
        <Dot key={p} pos={p} primary={false} />
      ))}
      {primary ? <Dot pos={primary} primary /> : null}
    </div>
  );
}
