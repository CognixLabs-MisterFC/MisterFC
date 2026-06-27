/**
 * Señas de jugada (TANDA 1) — renderer WEB del pictograma. Mapea las primitivas
 * neutras de `PLAY_SIGNAL_CATALOG` (core) a un `<svg>` del DOM. El gesto se dibuja
 * con `currentColor`, así que hereda el color del contenedor. (El renderer de
 * @react-pdf es aparte, tanda 2.)
 */

import { PLAY_SIGNAL_VIEWBOX, getPlaySignal, type PlaySignalId } from '@misterfc/core';
import { cn } from '@/lib/utils';

export function SignalIcon({
  signalId,
  className,
  title,
}: {
  signalId: PlaySignalId;
  className?: string;
  title?: string;
}) {
  const signal = getPlaySignal(signalId);
  if (!signal) return null;

  return (
    <svg
      viewBox={PLAY_SIGNAL_VIEWBOX}
      className={cn('size-full', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {signal.shapes.map((sh, i) => {
        if (sh.t === 'line') {
          return <line key={i} x1={sh.x1} y1={sh.y1} x2={sh.x2} y2={sh.y2} />;
        }
        if (sh.t === 'circle') {
          return (
            <circle
              key={i}
              cx={sh.cx}
              cy={sh.cy}
              r={sh.r}
              fill={sh.filled ? 'currentColor' : 'none'}
            />
          );
        }
        return <path key={i} d={sh.d} />;
      })}
    </svg>
  );
}
