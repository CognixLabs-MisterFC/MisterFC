/**
 * F11.0 — Esquema del DIAGRAMA de un ejercicio (contrato PURO de `@misterfc/core`).
 *
 * Spec: docs/specs/11.0-biblioteca-ejercicios.md §4.2 / §4.7. Es un contrato de
 * larga vida: lo heredan F11 (ficha/editor), F11B (pizarra en vivo), F12
 * (sesiones) y F13 (jugadas animadas). Aquí solo tipos/números + validación Zod:
 * SIN DOM, SIN React/SVG, SIN BD.
 *
 * Convenio de coordenadas (reutiliza el de `<MatchFieldEditor>` F6.3 como DATOS):
 *   - `x_pct` / `y_pct` son PORCENTAJES en [0,100] en AMBOS ejes (no unidades del
 *     viewBox). El renderer (11.5a) mapea el % a su viewBox escalando el eje largo;
 *     así pinta sobre `FieldMarkings` sin conversiones aquí.
 *   - Orientación por defecto "atacando hacia arriba" (vertical), como F6.
 *
 * Naming (decisión #142 + esta subfase): CLAVES en inglés, VALORES de dominio en
 * español. Dos conceptos separados para no mezclar idiomas en una clave:
 *   - `style`  = SEMÁNTICA de dominio (solo en la flecha): pase|conduccion|desmarque.
 *                El renderer deriva el aspecto visual de la semántica.
 *   - `stroke` = PRIMITIVA visual (en zona y línea): solid|dashed. Es rendering,
 *                no taxonomía → en inglés.
 *
 * Frame-extensibilidad (F13): cada elemento tiene un `id` ESTABLE y su posición es
 * SEPARABLE (ver `elementAnchors`). F13 envolverá la escena en frames e interpolará
 * posiciones por `id` entre frames — pero ESA forma la decide F13. Aquí se exporta
 * ÚNICAMENTE el `Diagram` estático; no se compromete el tipo de los frames.
 */

import { z } from 'zod';

/** Versión del contrato de la escena estática. */
export const DIAGRAM_VERSION = 1 as const;

/** Tope razonable de elementos por escena (evita payloads abusivos). */
export const MAX_DIAGRAM_ELEMENTS = 200;

/** Tope de puntos de una línea/trazo libre. */
export const MAX_LINE_POINTS = 500;

// ── Vocabularios de dominio (VALORES en español) ────────────────────────────
export const PLAYER_ROLES = ['atacante', 'defensor', 'comodin', 'portero'] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

/** Semántica de la flecha (clave `style`). El aspecto visual lo deriva el renderer. */
export const ARROW_STYLES = ['pase', 'conduccion', 'desmarque'] as const;
export type ArrowStyle = (typeof ARROW_STYLES)[number];

// ── Primitivas visuales (VALORES en inglés: rendering, no taxonomía) ─────────
/** Trazo visual (clave `stroke`) de zona y línea. */
export const STROKE_KINDS = ['solid', 'dashed'] as const;
export type StrokeKind = (typeof STROKE_KINDS)[number];

/** Relleno visual (clave `fill`) de la zona. Ausente = sin relleno (contorno).
 *  Primitiva de presentación (en inglés); la etiqueta visible se localiza.
 *  Enum (no boolean) para extender a más colores sin romper el contrato. */
export const ZONE_FILLS = ['green'] as const;
export type ZoneFill = (typeof ZONE_FILLS)[number];

/** Color de trazo (clave `color`) de flecha y línea (incl. trazo libre, F11B.0).
 *  Opcional y ADITIVO: AUSENTE = negro (color por defecto del renderer); valores
 *  extra `blue`/`red`. Primitiva visual (en inglés); la etiqueta se localiza.
 *  Retrocompatible: los diagramas sin `color` siguen siendo válidos. */
export const STROKE_COLORS = ['blue', 'red'] as const;
export type StrokeColor = (typeof STROKE_COLORS)[number];

/** Tamaño visual (clave `size`) de los elementos de PUNTO. Opcional; ausente =
 *  'md' (tamaño actual). En `texto` escala la fuente. La etiqueta se localiza. */
export const ELEMENT_SIZES = ['sm', 'md', 'lg'] as const;
export type ElementSize = (typeof ELEMENT_SIZES)[number];

export const FIELD_KINDS = ['completo', 'medio'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_ORIENTATIONS = ['vertical', 'horizontal'] as const;
export type FieldOrientation = (typeof FIELD_ORIENTATIONS)[number];

// ── Primitivas ──────────────────────────────────────────────────────────────
/** Porcentaje del campo [0,100] en cualquiera de los dos ejes. */
const pct = z
  .number()
  .min(0, { message: 'pct_out_of_range' })
  .max(100, { message: 'pct_out_of_range' });

/** Id estable del elemento (lo genera el cliente; clave de F13 para frames). */
const elementId = z
  .string()
  .min(1, { message: 'id_required' })
  .max(64, { message: 'id_too_long' });

const pointSchema = z.object({ x_pct: pct, y_pct: pct });
export type DiagramPoint = z.infer<typeof pointSchema>;

/** Tamaño opcional de los elementos de punto (ausente = 'md'). */
const sized = { size: z.enum(ELEMENT_SIZES).optional() };

/** Campos comunes de un elemento anclado por un único punto. */
const anchored = { id: elementId, x_pct: pct, y_pct: pct };

const rotation = z
  .number()
  .min(0, { message: 'rotation_out_of_range' })
  .max(360, { message: 'rotation_out_of_range' })
  .optional();

// ── Elementos (unión discriminada por `type`) ────────────────────────────────
const jugadorSchema = z.object({
  type: z.literal('jugador'),
  ...anchored,
  ...sized,
  role: z.enum(PLAYER_ROLES),
  label: z.string().max(40, { message: 'label_too_long' }).optional(),
});
const balonSchema = z.object({ type: z.literal('balon'), ...anchored, ...sized });
const conoSchema = z.object({ type: z.literal('cono'), ...anchored, ...sized });
const aroSchema = z.object({ type: z.literal('aro'), ...anchored, ...sized });
const golConduccionSchema = z.object({ type: z.literal('gol_conduccion'), ...anchored, ...sized });
const porteriaSchema = z.object({ type: z.literal('porteria'), ...anchored, ...sized, rotation });
const miniporteriaSchema = z.object({ type: z.literal('miniporteria'), ...anchored, ...sized, rotation });
const textoSchema = z.object({
  type: z.literal('texto'),
  ...anchored,
  ...sized,
  text: z.string().min(1, { message: 'text_required' }).max(120, { message: 'text_too_long' }),
});

const flechaSchema = z.object({
  type: z.literal('flecha'),
  id: elementId,
  from: pointSchema,
  to: pointSchema,
  style: z.enum(ARROW_STYLES), // semántica de dominio
  color: z.enum(STROKE_COLORS).optional(), // primitiva visual; ausente = negro
});

const lineaSchema = z.object({
  type: z.literal('linea'),
  id: elementId,
  points: z
    .array(pointSchema)
    .min(2, { message: 'linea_min_points' })
    .max(MAX_LINE_POINTS, { message: 'linea_too_many_points' }),
  stroke: z.enum(STROKE_KINDS).optional(), // primitiva visual, opcional
  color: z.enum(STROKE_COLORS).optional(), // primitiva visual; ausente = negro
});

const zonaSchema = z.object({
  type: z.literal('zona'),
  id: elementId,
  x_pct: pct,
  y_pct: pct,
  w_pct: pct,
  h_pct: pct,
  stroke: z.enum(STROKE_KINDS), // primitiva visual
  fill: z.enum(ZONE_FILLS).optional(), // relleno opcional (ausente = contorno)
});

const cotaSchema = z.object({
  type: z.literal('cota'),
  id: elementId,
  from: pointSchema,
  to: pointSchema,
  label: z.string().min(1, { message: 'label_required' }).max(40, { message: 'label_too_long' }),
});

export const diagramElementSchema = z.discriminatedUnion('type', [
  jugadorSchema,
  balonSchema,
  conoSchema,
  aroSchema,
  golConduccionSchema,
  porteriaSchema,
  miniporteriaSchema,
  textoSchema,
  flechaSchema,
  lineaSchema,
  zonaSchema,
  cotaSchema,
]);
export type DiagramElement = z.infer<typeof diagramElementSchema>;
export type DiagramElementType = DiagramElement['type'];

/** Lienzo que el renderer debe pintar (independiente de `space_type` del ejercicio). */
const fieldSchema = z.object({
  kind: z.enum(FIELD_KINDS),
  orientation: z.enum(FIELD_ORIENTATIONS).default('vertical'),
});
export type DiagramField = z.infer<typeof fieldSchema>;

export const diagramSchema = z
  .object({
    version: z.literal(DIAGRAM_VERSION),
    field: fieldSchema,
    elements: z
      .array(diagramElementSchema)
      .max(MAX_DIAGRAM_ELEMENTS, { message: 'too_many_elements' }),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.elements.forEach((el, i) => {
      // Ids únicos dentro de la escena (clave estable para F13).
      if (seen.has(el.id)) {
        ctx.addIssue({ code: 'custom', message: 'duplicate_id', path: ['elements', i, 'id'] });
      }
      seen.add(el.id);

      // Rangos: la zona (rect en %) debe caber dentro del campo y tener área.
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

/** Escena estática del diagrama (lo único que se exporta como contrato en 11.0). */
export type Diagram = z.infer<typeof diagramSchema>;

// ── API de validación ─────────────────────────────────────────────────────
/** Valida una escena (forma + rangos + ids únicos). No lanza. */
export function parseDiagram(input: unknown) {
  return diagramSchema.safeParse(input);
}

/** Type guard: ¿es una escena válida? */
export function isDiagram(input: unknown): input is Diagram {
  return diagramSchema.safeParse(input).success;
}

/** Escena vacía válida (punto de partida del editor). */
export function emptyDiagram(field?: Partial<DiagramField>): Diagram {
  return {
    version: DIAGRAM_VERSION,
    field: {
      kind: field?.kind ?? 'completo',
      orientation: field?.orientation ?? 'vertical',
    },
    elements: [],
  };
}

// ── Seam de frames (F13) ─────────────────────────────────────────────────────
/**
 * Puntos-ancla geométricos de un elemento, en orden. Hace EXPLÍCITO que la
 * posición es separable del resto del elemento: F13 interpolará estos puntos por
 * `id` entre frames. Aquí solo se exponen (no se interpola ni se comprometen los
 * frames).
 */
export function elementAnchors(el: DiagramElement): DiagramPoint[] {
  switch (el.type) {
    case 'flecha':
    case 'cota':
      return [el.from, el.to];
    case 'linea':
      return el.points;
    case 'zona':
      return [{ x_pct: el.x_pct, y_pct: el.y_pct }];
    default:
      return [{ x_pct: el.x_pct, y_pct: el.y_pct }];
  }
}
