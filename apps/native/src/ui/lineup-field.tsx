import { useCallback, useRef, type ReactNode } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Rect } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { Formation, PositionAssignment } from '@misterfc/core';

/**
 * O2-8b — Campo de ALINEACIÓN nativo INTERACTIVO (drag por slots). Evoluciona el
 * `LineupField` de 8a (SVG de marcas + fichas/slots como Views absolutas) a un tablero
 * con GESTO: arrastrar una ficha con el dedo y soltarla sobre un slot (colocar/swap) o
 * sobre el banquillo (sentar). Reutiliza el modelo de core: la GEOMETRÍA (slots
 * xPct/yPct 0–100) y la resolución del drop (`applyDrop`) NO se reimplementan aquí —
 * este componente solo traduce el gesto a un `DropTarget` por HIT-TESTING y avisa al
 * llamador (`onDrop`), que aplica `applyDrop` + escribe.
 *
 * CRUCE UI-THREAD → JS-THREAD: el gesto corre en el worklet de UI (la ficha sigue al
 * dedo con shared values, fluido, sin tocar JS). El movimiento cruza a JS con `runOnJS`
 * SOLO cuando hace falta: al empezar (medir), al cambiar de slot bajo el dedo
 * (resaltar destino, gateado por 8px para no saturar el puente) y al soltar (resolver
 * destino + escribir). La escritura y el setState ocurren en JS sin bloquear el gesto.
 *
 * HIT-TESTING por coordenadas de VENTANA (dedo `absoluteX/absoluteY`): al empezar el
 * gesto medimos el campo y el banquillo con `measureInWindow` y derivamos el centro de
 * cada slot en coords de ventana. Así el mapeo del drop es el mismo venga la ficha del
 * campo o del banquillo — sin depender de dónde arrancó.
 */

const CHIP = 34; // diámetro del disco
const BOX = 62; // ancho del contenedor de ficha (disco + etiqueta)
const SLOT_HIT_FACTOR = 0.18; // radio de acierto de slot = 18% del ancho del campo

export type DropTargetLite =
  | { kind: 'field'; slotCode: string }
  | { kind: 'bench' };

type LayoutRect = { x: number; y: number; w: number; h: number };
type SlotCenter = { code: string; x: number; y: number };

type FieldChip = {
  playerId: string;
  label: string;
  dorsal: number | null;
  xPct: number;
  yPct: number;
};
type EmptySlot = { code: string; label: string; xPct: number; yPct: number };
type BenchChip = { playerId: string; label: string; dorsal: number | null };

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

/**
 * Ficha arrastrable. El disco/etiqueta viven en el worklet: `tx/ty` (traslación) y
 * `active` (resalte) se animan en el hilo de UI. Los saltos a JS (`onStart/onMove/
 * onEnd`) van por `runOnJS`. `centerX/centerY` centran la ficha sobre su punto (el
 * transform animado sustituye al estático, así que el centrado se hornea aquí).
 */
function DraggableChip({
  playerId,
  editable,
  centerX,
  centerY,
  saving,
  onStart,
  onMove,
  onEnd,
  children,
}: {
  playerId: string;
  editable: boolean;
  centerX: number;
  centerY: number;
  saving: boolean;
  onStart: (playerId: string) => void;
  onMove: (absX: number, absY: number) => void;
  onEnd: (playerId: string, absX: number, absY: number) => void;
  children: ReactNode;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const active = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(editable && !saving)
    .onBegin((e) => {
      active.value = 1;
      lastX.value = e.absoluteX;
      lastY.value = e.absoluteY;
      runOnJS(onStart)(playerId);
    })
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
      // Gateado por 8px: solo cruzamos a JS al moverse lo suficiente (resaltar
      // el destino), no en cada frame — el puente no se satura.
      if (
        Math.abs(e.absoluteX - lastX.value) + Math.abs(e.absoluteY - lastY.value) >
        8
      ) {
        lastX.value = e.absoluteX;
        lastY.value = e.absoluteY;
        runOnJS(onMove)(e.absoluteX, e.absoluteY);
      }
    })
    .onEnd((e) => {
      runOnJS(onEnd)(playerId, e.absoluteX, e.absoluteY);
      // Snap inmediato: el estado optimista recoloca la base; sin muelle no hay
      // salto entre "posición del dedo" y la nueva base.
      tx.value = 0;
      ty.value = 0;
      active.value = 0;
    })
    .onFinalize(() => {
      tx.value = 0;
      ty.value = 0;
      active.value = 0;
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: centerX + tx.value },
      { translateY: centerY + ty.value },
      { scale: active.value ? 1.12 : 1 },
    ],
    zIndex: active.value ? 100 : 1,
    elevation: active.value ? 8 : 0,
    opacity: saving ? 0.5 : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: 'absolute' }, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

function ChipVisual({
  label,
  dorsal,
  color,
}: {
  label: string;
  dorsal: number | null;
  color: string;
}) {
  return (
    <View style={{ width: BOX, alignItems: 'center' }}>
      <View
        style={{
          width: CHIP,
          height: CHIP,
          borderRadius: CHIP / 2,
          backgroundColor: color,
          borderWidth: 2,
          borderColor: '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
          {dorsal ?? '·'}
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
          maxWidth: BOX,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function LineupBoard({
  formation,
  positions,
  labelOf,
  dorsalOf,
  slotLabelOf,
  editable,
  savingIds,
  chipColor,
  benchTitle,
  benchEmptyText,
  onDrop,
  hoverCode,
  hoverBench,
  onHoverChange,
}: {
  formation: Formation | undefined;
  positions: PositionAssignment[];
  labelOf: (playerId: string) => string;
  dorsalOf: (playerId: string) => number | null;
  slotLabelOf: (slotCode: string, role: string) => string;
  editable: boolean;
  savingIds: ReadonlySet<string>;
  chipColor: string;
  benchTitle: string;
  benchEmptyText: string;
  onDrop: (playerId: string, target: DropTargetLite) => void;
  hoverCode: string | null;
  hoverBench: boolean;
  onHoverChange: (h: { code: string | null; bench: boolean }) => void;
}) {
  const { width: winW } = useWindowDimensions();
  const width = Math.min(winW - 32, 420);
  const height = width * 1.5; // aspecto 2:3, igual que la web

  const fieldRef = useRef<View>(null);
  const benchRef = useRef<View>(null);
  const fieldRectRef = useRef<LayoutRect | null>(null);
  const benchRectRef = useRef<LayoutRect | null>(null);
  const slotCentersRef = useRef<SlotCenter[]>([]);

  // Mide campo + banquillo (coords de ventana) y deriva los centros de slot. Se
  // llama al empezar el gesto (el scroll no cambia durante el arrastre capturado).
  const measure = useCallback(() => {
    fieldRef.current?.measureInWindow((x, y, w, h) => {
      fieldRectRef.current = { x, y, w, h };
      slotCentersRef.current = (formation?.slots ?? []).map((s) => ({
        code: s.code,
        x: x + (s.xPct / 100) * w,
        y: y + (s.yPct / 100) * h,
      }));
    });
    benchRef.current?.measureInWindow((x, y, w, h) => {
      benchRectRef.current = { x, y, w, h };
    });
  }, [formation]);

  const resolveTarget = useCallback(
    (absX: number, absY: number): DropTargetLite | null => {
      const b = benchRectRef.current;
      if (b && absX >= b.x && absX <= b.x + b.w && absY >= b.y && absY <= b.y + b.h) {
        return { kind: 'bench' };
      }
      const centers = slotCentersRef.current;
      const fw = fieldRectRef.current?.w ?? width;
      let best: SlotCenter | null = null;
      let bestD = Infinity;
      for (const c of centers) {
        const d = Math.hypot(absX - c.x, absY - c.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best && bestD <= fw * SLOT_HIT_FACTOR) {
        return { kind: 'field', slotCode: best.code };
      }
      return null;
    },
    [width],
  );

  const onStart = useCallback(() => measure(), [measure]);
  const onMove = useCallback(
    (absX: number, absY: number) => {
      const t = resolveTarget(absX, absY);
      onHoverChange({
        code: t?.kind === 'field' ? t.slotCode : null,
        bench: t?.kind === 'bench',
      });
    },
    [resolveTarget, onHoverChange],
  );
  const onEnd = useCallback(
    (playerId: string, absX: number, absY: number) => {
      const t = resolveTarget(absX, absY);
      onHoverChange({ code: null, bench: false });
      if (t) onDrop(playerId, t);
    },
    [resolveTarget, onHoverChange, onDrop],
  );

  // ── Reparto de fichas en campo (por slot) vs slots vacíos ────────────────────
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
  // Fichas en campo NO colocadas por el bucle de slots → en sus PROPIAS coords.
  // Cubre (a) formación cambiada (positionCode obsoleto que no casa slot) y
  // (b) Bug 4: la `formation` no está disponible (personalizada que el viewer —
  // familia — no resuelve por RLS de coach_formations) → el bucle de slots no
  // corrió, pero las coords ya viven en la propia posición (snapshot al colocar).
  // La dedup la garantiza `chips.some`: nunca se re-añade a un jugador ya colocado
  // por su slot, así que en el caso normal (catálogo) no se duplican fichas.
  for (const p of fieldPositions) {
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

  const bench: BenchChip[] = positions
    .filter((p) => p.location === 'bench')
    .map((p) => ({
      playerId: p.playerId,
      label: labelOf(p.playerId),
      dorsal: dorsalOf(p.playerId),
    }));

  const cx = (xPct: number) => (xPct / 100) * width;
  const cy = (yPct: number) => (yPct / 100) * height;

  return (
    <View style={{ gap: 12 }}>
      {/* ── CAMPO ── */}
      <View
        ref={fieldRef}
        onLayout={measure}
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

        {/* Slots vacíos: destino del drag; resaltan al pasar el dedo por encima. */}
        {emptySlots.map((s) => {
          const hot = hoverCode === s.code;
          return (
            <View
              key={`slot-${s.code}`}
              style={{
                position: 'absolute',
                left: cx(s.xPct),
                top: cy(s.yPct),
                transform: [{ translateX: -CHIP / 2 }, { translateY: -CHIP / 2 }],
                width: CHIP,
                height: CHIP,
                borderRadius: CHIP / 2,
                borderWidth: hot ? 2.5 : 1.5,
                borderStyle: 'dashed',
                borderColor: hot ? '#fde047' : 'rgba(255,255,255,0.7)',
                backgroundColor: hot ? 'rgba(253,224,71,0.25)' : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)' }}>
                {s.label}
              </Text>
            </View>
          );
        })}

        {/* Fichas de titulares: arrastrables (cada una lleva su playerId). */}
        {chips.map((c) => (
          <DraggableChip
            key={`chip-${c.playerId}`}
            playerId={c.playerId}
            editable={editable}
            saving={savingIds.has(c.playerId)}
            centerX={cx(c.xPct) - BOX / 2}
            centerY={cy(c.yPct) - CHIP / 2}
            onStart={onStart}
            onMove={onMove}
            onEnd={onEnd}
          >
            <ChipVisual label={c.label} dorsal={c.dorsal} color={chipColor} />
          </DraggableChip>
        ))}
      </View>

      {/* ── BANQUILLO (zona de drop + fichas arrastrables) ── */}
      <View
        ref={benchRef}
        onLayout={measure}
        style={{
          borderRadius: 16,
          borderWidth: hoverBench ? 2 : 1,
          borderColor: hoverBench ? '#fbbf24' : '#e4e4e7',
          backgroundColor: hoverBench ? 'rgba(251,191,36,0.08)' : 'transparent',
          padding: 12,
          minHeight: 76,
        }}
      >
        <Text
          style={{
            marginBottom: 8,
            fontSize: 11,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#a1a1aa',
          }}
        >
          {benchTitle} · {bench.length}
        </Text>
        {bench.length === 0 ? (
          <Text style={{ fontSize: 13, color: '#71717a' }}>{benchEmptyText}</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {bench.map((p) => (
              <BenchDraggable
                key={`bench-${p.playerId}`}
                playerId={p.playerId}
                editable={editable}
                saving={savingIds.has(p.playerId)}
                onStart={onStart}
                onMove={onMove}
                onEnd={onEnd}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: '#e4e4e7',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    backgroundColor: '#fff',
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: '#f4f4f5',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#52525b' }}>
                      {p.dorsal ?? '·'}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#0F1B2E' }} numberOfLines={1}>
                    {p.label}
                  </Text>
                </View>
              </BenchDraggable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Ficha de banquillo arrastrable. Igual gesto que `DraggableChip` pero SIN
 * posicionamiento absoluto (vive en el wrap del banquillo): solo traslada/realza y
 * cruza a JS por `runOnJS`. El hit-testing del drop usa las coords del dedo.
 */
function BenchDraggable({
  playerId,
  editable,
  saving,
  onStart,
  onMove,
  onEnd,
  children,
}: {
  playerId: string;
  editable: boolean;
  saving: boolean;
  onStart: (playerId: string) => void;
  onMove: (absX: number, absY: number) => void;
  onEnd: (playerId: string, absX: number, absY: number) => void;
  children: ReactNode;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const active = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(editable && !saving)
    .onBegin((e) => {
      active.value = 1;
      lastX.value = e.absoluteX;
      lastY.value = e.absoluteY;
      runOnJS(onStart)(playerId);
    })
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
      if (
        Math.abs(e.absoluteX - lastX.value) + Math.abs(e.absoluteY - lastY.value) >
        8
      ) {
        lastX.value = e.absoluteX;
        lastY.value = e.absoluteY;
        runOnJS(onMove)(e.absoluteX, e.absoluteY);
      }
    })
    .onEnd((e) => {
      runOnJS(onEnd)(playerId, e.absoluteX, e.absoluteY);
      tx.value = 0;
      ty.value = 0;
      active.value = 0;
    })
    .onFinalize(() => {
      tx.value = 0;
      ty.value = 0;
      active.value = 0;
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: active.value ? 1.12 : 1 },
    ],
    zIndex: active.value ? 100 : 1,
    elevation: active.value ? 8 : 0,
    opacity: saving ? 0.5 : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}
