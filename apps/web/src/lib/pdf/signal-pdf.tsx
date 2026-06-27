/**
 * Señas de jugada (TANDA 2) — renderer @react-pdf del pictograma. Mapea las
 * primitivas neutras de `PLAY_SIGNAL_CATALOG` (core) a `<Svg>` de @react-pdf, el
 * gemelo del `SignalIcon` web. @react-pdf NO cascada `currentColor`, así que el
 * trazo va con un color fijo. Mismo viewBox que la web → idéntico dibujo.
 */

import { Svg, Line, Circle, Path } from '@react-pdf/renderer';
import { PLAY_SIGNAL_VIEWBOX, getPlaySignal, type PlaySignalId } from '@misterfc/core';

const STROKE = '#1f2937'; // gris-800 (consistente con el texto del PDF)

export function SignalPdf({
  signalId,
  size = 22,
}: {
  signalId: PlaySignalId;
  size?: number;
}): React.ReactElement | null {
  const signal = getPlaySignal(signalId);
  if (!signal) return null;

  return (
    <Svg viewBox={PLAY_SIGNAL_VIEWBOX} width={size} height={size}>
      {signal.shapes.map((sh, i) => {
        if (sh.t === 'line') {
          return (
            <Line
              key={i}
              x1={sh.x1}
              y1={sh.y1}
              x2={sh.x2}
              y2={sh.y2}
              stroke={STROKE}
              strokeWidth={2}
            />
          );
        }
        if (sh.t === 'circle') {
          return (
            <Circle
              key={i}
              cx={sh.cx}
              cy={sh.cy}
              r={sh.r}
              stroke={STROKE}
              strokeWidth={2}
              fill={sh.filled ? STROKE : 'none'}
            />
          );
        }
        return <Path key={i} d={sh.d} stroke={STROKE} strokeWidth={2} fill="none" />;
      })}
    </Svg>
  );
}
