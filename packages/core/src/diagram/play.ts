/**
 * F13.1a — Contrato de la JUGADA ANIMADA (playbook), PURO `@misterfc/core`.
 *
 * Spec: docs/specs/13.0-pizarra-jugadas-animadas.md §4 (D3/D4/D5). Vive ENCIMA del
 * contrato del diagrama (F11) sin modificarlo: reutiliza `diagramElementSchema`,
 * `fieldSchema` y `elementAnchors`. Sin DOM, sin React, sin BD: solo Zod + lógica
 * pura (testeable con Vitest).
 *
 * Modelo (D3 — frame = escena COMPLETA):
 *   Play = { version, field, frames: [{ elements[], duration_ms? }] }
 * El `field` es común a todos los frames (el campo no cambia). Cada frame lleva su
 * `elements[]` íntegro (mismo validador de F11) y valida ids únicos DENTRO del
 * frame. Un mismo `id` repetido entre frames = "el mismo" elemento (se interpola);
 * un `id` nuevo = elemento que aparece.
 *
 * Versionado: `PLAY_VERSION` es INDEPENDIENTE de `DIAGRAM_VERSION` (la jugada puede
 * evolucionar —p.ej. easing— sin tocar el contrato del diagrama, y viceversa).
 *
 * Interpolación (D5 — base de 13.3): `sceneAtTime` casa elementos por `id` entre
 * el frame de origen y el de destino e interpola SOLO sus anclas (`elementAnchors`)
 * con lerp lineal; las props discretas (rol/color/label/estilo/tamaño) se copian
 * del ORIGEN (saltan en el límite de frame). Un elemento presente en un solo lado
 * aparece/desaparece con un FADE (opacidad).
 */

import { z } from 'zod';
import {
  DIAGRAM_VERSION,
  MAX_DIAGRAM_ELEMENTS,
  diagramElementSchema,
  fieldSchema,
  elementAnchors,
  type DiagramElement,
  type DiagramField,
  type DiagramPoint,
} from './diagram';

export const PLAY_VERSION = 1 as const;
export const MAX_FRAMES = 60; // tope de seguridad por jugada
export const DEFAULT_FRAME_MS = 1000; // D4: tempo por defecto entre frames
export const MIN_FRAME_MS = 100;
export const MAX_FRAME_MS = 20000;

// ── Schema ───────────────────────────────────────────────────────────────────
// Un frame = una escena del diagrama (D3) + su duración de transición HACIA el
// siguiente frame (D4). `field` NO va en el frame: es común a la jugada.
const frameSchema = z
  .object({
    elements: z
      .array(diagramElementSchema)
      .max(MAX_DIAGRAM_ELEMENTS, { message: 'too_many_elements' }),
    duration_ms: z.number().int().min(MIN_FRAME_MS).max(MAX_FRAME_MS).optional(),
  })
  // Mismas reglas que `diagramSchema` pero POR FRAME (no se modifica el contrato
  // del diagrama: se replican aquí para no acoplar los dos esquemas).
  .superRefine((frame, ctx) => {
    const seen = new Set<string>();
    frame.elements.forEach((el, i) => {
      if (seen.has(el.id)) {
        ctx.addIssue({ code: 'custom', message: 'duplicate_id', path: ['elements', i, 'id'] });
      }
      seen.add(el.id);
      if (el.type === 'zona') {
        if (el.w_pct <= 0 || el.h_pct <= 0) {
          ctx.addIssue({ code: 'custom', message: 'zona_empty', path: ['elements', i] });
        }
        if (el.x_pct + el.w_pct > 100 || el.y_pct + el.h_pct > 100) {
          ctx.addIssue({ code: 'custom', message: 'zona_out_of_field', path: ['elements', i] });
        }
      }
    });
  });
export type PlayFrame = z.infer<typeof frameSchema>;

export const playSchema = z.object({
  version: z.literal(PLAY_VERSION),
  field: fieldSchema, // campo común a todos los frames
  frames: z
    .array(frameSchema)
    .min(1, { message: 'play_min_frames' })
    .max(MAX_FRAMES, { message: 'play_too_many_frames' }),
});
/** El "data" jsonb de la BD (13.1b). */
export type Play = z.infer<typeof playSchema>;

// ── Escena de reproducción (salida de `sceneAtTime`) ──────────────────────────
/**
 * Elemento de una escena interpolada: un `DiagramElement` + una `opacity` de
 * PRESENTACIÓN opcional para el fade de aparición/desaparición. AUSENTE = 1
 * (opaco), igual convenio aditivo que `color`/`size` en el diagrama. NO se
 * persiste: es de render. `<DiagramView>` (13.3) la consumirá.
 */
export type SceneElement = DiagramElement & { opacity?: number };

/**
 * Escena estática lista para pintar con `<DiagramView>`. Es un `Diagram` (mismo
 * `version`/`field`/`elements`) cuyos elementos pueden llevar `opacity`. Por ser
 * un superconjunto ADITIVO, un `Scene` es asignable a `Diagram`.
 */
export type Scene = {
  version: typeof DIAGRAM_VERSION;
  field: DiagramField;
  elements: SceneElement[];
};

// ── API de validación / construcción ─────────────────────────────────────────
/** Valida una jugada (forma + ids únicos por frame + rangos). No lanza. */
export function parsePlay(input: unknown) {
  return playSchema.safeParse(input);
}

/** Type guard: ¿es una jugada válida? */
export function isPlay(input: unknown): input is Play {
  return playSchema.safeParse(input).success;
}

/** Jugada vacía válida (1 frame vacío) — punto de partida del editor (13.2). */
export function emptyPlay(field?: Partial<DiagramField>): Play {
  return {
    version: PLAY_VERSION,
    field: {
      kind: field?.kind ?? 'completo',
      orientation: field?.orientation ?? 'vertical',
    },
    frames: [{ elements: [] }],
  };
}

/** Añade un frame al final (por defecto vacío). Puro: no muta la jugada dada.
 *  La validación de tope (`MAX_FRAMES`) la hace `parsePlay`. */
export function addFrame(play: Play, frame?: PlayFrame): Play {
  return { ...play, frames: [...play.frames, frame ?? { elements: [] }] };
}

// ── Duración / interpolación ──────────────────────────────────────────────────
function frameDurationMs(frame: PlayFrame): number {
  return frame.duration_ms ?? DEFAULT_FRAME_MS;
}

/**
 * Duración total de la jugada en ms: suma de la transición de cada frame HACIA el
 * siguiente (D4) → frames `0..n-2` (la `duration_ms` del último NO cuenta, no hay
 * transición después). Una jugada de 1 frame dura 0.
 */
export function playDurationMs(play: Play): number {
  let total = 0;
  for (let i = 0; i < play.frames.length - 1; i++) {
    const f = play.frames[i];
    if (f) total += frameDurationMs(f);
  }
  return total;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
const lerpPoint = (a: DiagramPoint, b: DiagramPoint, p: number): DiagramPoint => ({
  x_pct: lerp(a.x_pct, b.x_pct, p),
  y_pct: lerp(a.y_pct, b.y_pct, p),
});

/**
 * Inverso de `elementAnchors`: reconstruye un elemento con NUEVAS anclas,
 * conservando el resto de campos (props discretas). Solo cambia la geometría
 * posicional; la zona conserva su `w_pct`/`h_pct` (no son anclas).
 */
function withAnchors(el: DiagramElement, anchors: DiagramPoint[]): DiagramElement {
  switch (el.type) {
    case 'flecha':
    case 'cota':
      return { ...el, from: anchors[0] ?? el.from, to: anchors[1] ?? el.to };
    case 'linea':
      return { ...el, points: anchors.length >= 2 ? anchors : el.points };
    case 'zona': {
      const a = anchors[0];
      return a ? { ...el, x_pct: a.x_pct, y_pct: a.y_pct } : el;
    }
    default: {
      const a = anchors[0];
      return a ? { ...el, x_pct: a.x_pct, y_pct: a.y_pct } : el;
    }
  }
}

/**
 * Interpola un elemento entre `src` y `dst` (mismo `id`) en el progreso `p∈[0,1]`.
 * D5: props discretas del ORIGEN; solo se interpolan las anclas. Si el tipo difiere
 * o el nº de anclas no casa (p.ej. una `linea` con distinto nº de puntos entre
 * frames), NO se interpola la geometría: se usa el origen tal cual.
 */
function interpolateElement(src: DiagramElement, dst: DiagramElement, p: number): DiagramElement {
  if (src.type !== dst.type) return src;
  const a = elementAnchors(src);
  const b = elementAnchors(dst);
  if (a.length !== b.length) return src;
  const lerped = a.map((pt, i) => lerpPoint(pt, b[i] ?? pt, p));
  return withAnchors(src, lerped);
}

function staticScene(field: DiagramField, frame: PlayFrame): Scene {
  return {
    version: DIAGRAM_VERSION,
    field,
    elements: frame.elements.map((el) => ({ ...el })),
  };
}

function transitionScene(
  field: DiagramField,
  src: PlayFrame,
  dst: PlayFrame,
  p: number,
): Scene {
  const dstById = new Map(dst.elements.map((el) => [el.id, el]));
  const srcIds = new Set(src.elements.map((el) => el.id));
  const elements: SceneElement[] = [];

  // 1) Elementos del ORIGEN, en su orden:
  //    - en ambos frames  → interpolados (opacos, sin `opacity`).
  //    - solo en origen   → fade-out (`opacity` 1→0 según p).
  for (const el of src.elements) {
    const match = dstById.get(el.id);
    if (match) elements.push(interpolateElement(el, match, p));
    else elements.push({ ...el, opacity: clamp01(1 - p) });
  }
  // 2) Elementos SOLO en destino → fade-in (`opacity` 0→1), tras los del origen.
  for (const el of dst.elements) {
    if (!srcIds.has(el.id)) elements.push({ ...el, opacity: clamp01(p) });
  }

  return { version: DIAGRAM_VERSION, field, elements };
}

/**
 * Escena de la jugada en el instante `t_ms` (ms desde el inicio):
 *  - `t ≤ 0` → primer frame estático.
 *  - `t ≥ playDurationMs` → último frame estático.
 *  - en medio → transición `i → i+1`: posiciones interpoladas por `id`, props del
 *    origen (D5), aparición/desaparición con fade (`opacity`).
 *
 * Puro y sin reloj: el componente de reproducción (13.3) lleva el rAF y llama aquí.
 */
export function sceneAtTime(play: Play, t_ms: number): Scene {
  const frames = play.frames;
  const n = frames.length;
  const first = frames[0];
  const last = frames[n - 1];
  if (!first || !last) return { version: DIAGRAM_VERSION, field: play.field, elements: [] };
  if (n === 1) return staticScene(play.field, first);

  const total = playDurationMs(play);
  if (t_ms <= 0) return staticScene(play.field, first);
  if (t_ms >= total) return staticScene(play.field, last);

  // Localiza la transición i→i+1 que contiene a `t` y su progreso local p∈[0,1).
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const src = frames[i];
    const dst = frames[i + 1];
    if (!src || !dst) break;
    const dur = frameDurationMs(src);
    if (t_ms < acc + dur) {
      const p = dur > 0 ? (t_ms - acc) / dur : 0;
      return transitionScene(play.field, src, dst, p);
    }
    acc += dur;
  }
  // Defensivo (redondeos): t muy próximo al total → último frame.
  return staticScene(play.field, last);
}
