import Svg, { Circle, Line, Path } from 'react-native-svg';
import { PLAY_SIGNAL_VIEWBOX, getPlaySignal, type PlaySignalId } from '@misterfc/core';

/**
 * Punto 5 QA — Renderer NATIVO de la seña de una jugada (react-native-svg). Port del
 * `SignalIcon` web (apps/web/.../signal-icon.tsx): mapea las mismas primitivas neutras
 * de `PLAY_SIGNAL_CATALOG` (core) a `<Svg>`/`<Line>`/`<Circle>`/`<Path>`, sin duplicar
 * el dibujo. El monigote hereda el `color` (trazo), como en la web con `currentColor`.
 */
export function SignalIcon({
  signalId,
  size = 28,
  color = '#0F1B2E',
}: {
  signalId: PlaySignalId;
  size?: number;
  color?: string;
}) {
  const signal = getPlaySignal(signalId);
  if (!signal) return null;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={PLAY_SIGNAL_VIEWBOX}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {signal.shapes.map((sh, i) => {
        if (sh.t === 'line') {
          return <Line key={i} x1={sh.x1} y1={sh.y1} x2={sh.x2} y2={sh.y2} />;
        }
        if (sh.t === 'circle') {
          return (
            <Circle
              key={i}
              cx={sh.cx}
              cy={sh.cy}
              r={sh.r}
              fill={sh.filled ? color : 'none'}
            />
          );
        }
        return <Path key={i} d={sh.d} />;
      })}
    </Svg>
  );
}
