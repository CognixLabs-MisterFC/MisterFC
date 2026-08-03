import { useWindowDimensions, View, Text } from 'react-native';
import Svg, { Circle, G, Line, Rect } from 'react-native-svg';
import type { Formation, PositionAssignment } from '@misterfc/core';

/**
 * O2-8a — Campo de ALINEACIÓN nativo (SVG marcas + fichas encima), SOLO PINTAR (sin
 * gesto). Reutiliza la técnica de `PlayField` (D2): react-native-svg con viewBox
 * `0 0 100 150` (atacando arriba, área propia abajo) — MISMAS marcas que el
 * `FieldMarkings` de la web, para que los slots (xPct/yPct 0–100 de core) cuadren.
 * Las fichas y los slots vacíos NO son SVG: son Views absolutas posicionadas por
 * `left/top` en % del contenedor (como los chips HTML de la web).
 *
 * ESTRUCTURA PREPARADA PARA 8b: cada slot vacío lleva su `code` (zona destino del
 * drag) y cada ficha su `playerId` (elemento arrastrable). En 8a son estáticos; en
 * 8b se envuelven en el gesto sin recolocar nada.
 */

const CHIP = 34;

type FieldChip = {
  playerId: string;
  label: string;
  dorsal: number | null;
  xPct: number;
  yPct: number;
};

type EmptySlot = { code: string; label: string; xPct: number; yPct: number };

/** Marcas del campo completo (idénticas a la web / PlayField). */
function FieldMarkings() {
  const line = 'rgba(255,255,255,0.5)';
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

export function LineupField({
  formation,
  positions,
  labelOf,
  dorsalOf,
  slotLabelOf,
}: {
  formation: Formation | undefined;
  positions: PositionAssignment[];
  labelOf: (playerId: string) => string;
  dorsalOf: (playerId: string) => number | null;
  /** Etiqueta corta del slot vacío (rol/posición). */
  slotLabelOf: (slotCode: string, role: string) => string;
}) {
  const { width: winW } = useWindowDimensions();
  const width = Math.min(winW - 32, 420);
  const height = width * 1.5; // aspecto 2:3, igual que la web

  const fieldPositions = positions.filter((p) => p.location === 'field');
  const byCode = new Map(
    fieldPositions.filter((p) => p.positionCode).map((p) => [p.positionCode!, p]),
  );

  const chips: FieldChip[] = [];
  const emptySlots: EmptySlot[] = [];

  if (formation) {
    for (const slot of formation.slots) {
      const occupant = byCode.get(slot.code);
      if (occupant) {
        chips.push({
          playerId: occupant.playerId,
          label: labelOf(occupant.playerId),
          dorsal: dorsalOf(occupant.playerId),
          xPct: occupant.xPct ?? slot.xPct,
          yPct: occupant.yPct ?? slot.yPct,
        });
      } else {
        emptySlots.push({
          code: slot.code,
          label: slotLabelOf(slot.code, slot.role),
          xPct: slot.xPct,
          yPct: slot.yPct,
        });
      }
    }
  }
  // Fichas en campo sin slot casado (p.ej. tras cambiar de formación): en sus coords.
  for (const p of fieldPositions) {
    if (p.positionCode && byCode.get(p.positionCode) === p) continue;
    if (p.xPct == null || p.yPct == null) continue;
    if (chips.some((c) => c.playerId === p.playerId)) continue;
    chips.push({
      playerId: p.playerId,
      label: labelOf(p.playerId),
      dorsal: dorsalOf(p.playerId),
      xPct: p.xPct,
      yPct: p.yPct,
    });
  }

  return (
    <View
      style={{
        width,
        height,
        alignSelf: 'center',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <Svg
        width={width}
        height={height}
        viewBox="0 0 100 150"
        preserveAspectRatio="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <FieldMarkings />
      </Svg>

      {/* Slots vacíos (zonas destino para 8b: cada uno lleva su `code`). */}
      {emptySlots.map((s) => (
        <View
          key={`slot-${s.code}`}
          style={{
            position: 'absolute',
            left: `${s.xPct}%`,
            top: `${s.yPct}%`,
            transform: [{ translateX: -CHIP / 2 }, { translateY: -CHIP / 2 }],
            width: CHIP,
            height: CHIP,
            borderRadius: CHIP / 2,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: 'rgba(255,255,255,0.7)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)' }}>
            {s.label}
          </Text>
        </View>
      ))}

      {/* Fichas de titulares (arrastrables en 8b: cada una lleva su `playerId`). */}
      {chips.map((c) => (
        <View
          key={`chip-${c.playerId}`}
          style={{
            position: 'absolute',
            left: `${c.xPct}%`,
            top: `${c.yPct}%`,
            transform: [{ translateX: -CHIP / 2 }, { translateY: -CHIP / 2 }],
            alignItems: 'center',
            width: CHIP + 24,
            marginLeft: -12,
          }}
        >
          <View
            style={{
              width: CHIP,
              height: CHIP,
              borderRadius: CHIP / 2,
              backgroundColor: '#0f766e',
              borderWidth: 2,
              borderColor: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
              {c.dorsal ?? '·'}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{
              marginTop: 2,
              fontSize: 9,
              color: '#fff',
              backgroundColor: 'rgba(0,0,0,0.55)',
              paddingHorizontal: 3,
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            {c.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
