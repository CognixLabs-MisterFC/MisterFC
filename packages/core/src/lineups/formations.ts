/**
 * F6 — Catálogo de formaciones en código (ADR-0013).
 *
 * Datos de referencia estáticos del fútbol base español, por modalidad
 * (teams.format). NO viven en BD: cambian con un release, no por club. Cada
 * formación es un conjunto de slots con coordenadas 0–100 (ver types.ts para
 * la orientación del sistema).
 *
 * Los presets se declaran como FILAS ordenadas de defensa (atrás, y alto) a
 * ataque (arriba, y bajo). El builder reparte cada fila horizontalmente y
 * autogenera los códigos de slot (`GK`, `DF1`, `MF2`, …). Así el catálogo es
 * legible y con poca superficie de error.
 */

import type { Formation, FormationSlot, SlotRole, TeamFormat } from './types';

interface Row {
  role: SlotRole;
  /** Coordenada vertical (0 arriba/ataque, 100 abajo/portería propia). */
  y: number;
  /** Nº de jugadores en la fila. */
  n: number;
}

/** Margen lateral: ningún slot pegado a la banda. */
const X_MARGIN = 12;

/** Reparte n posiciones en x dentro de [X_MARGIN, 100 - X_MARGIN]. */
function spreadX(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [50];
  const span = 100 - 2 * X_MARGIN;
  return Array.from({ length: n }, (_, i) =>
    Math.round((X_MARGIN + (span * i) / (n - 1)) * 100) / 100,
  );
}

/**
 * Construye una formación a partir de filas. Inserta siempre un GK en (50, 94)
 * cuando la primera fila no es ya el portero. Los códigos se numeran por rol.
 */
function build(
  code: string,
  format: TeamFormat,
  rows: Row[],
): Formation {
  const slots: FormationSlot[] = [];
  const counters: Record<SlotRole, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };

  // Portero implícito si no se declara una fila GK.
  const hasGk = rows.some((r) => r.role === 'GK');
  const allRows: Row[] = hasGk ? rows : [{ role: 'GK', y: 94, n: 1 }, ...rows];

  for (const row of allRows) {
    const xs = spreadX(row.n);
    for (const x of xs) {
      counters[row.role] += 1;
      const codeSuffix = row.role === 'GK' ? '' : String(counters[row.role]);
      slots.push({
        code: `${row.role}${codeSuffix}`,
        role: row.role,
        xPct: x,
        yPct: row.y,
      });
    }
  }

  return { code, label: code, format, slots };
}

// ─────────────────────────────────────────────────────────────────────────────
// F7 — 6 de campo + portero.
// ─────────────────────────────────────────────────────────────────────────────

const F7: Formation[] = [
  build('1-3-3', 'F7', [
    { role: 'DF', y: 70, n: 3 },
    { role: 'FW', y: 38, n: 3 },
  ]),
  build('1-3-2-1', 'F7', [
    { role: 'DF', y: 72, n: 3 },
    { role: 'MF', y: 48, n: 2 },
    { role: 'FW', y: 24, n: 1 },
  ]),
  build('1-2-3-1', 'F7', [
    { role: 'DF', y: 72, n: 2 },
    { role: 'MF', y: 48, n: 3 },
    { role: 'FW', y: 24, n: 1 },
  ]),
  build('1-2-1-2-1', 'F7', [
    { role: 'DF', y: 74, n: 2 },
    { role: 'MF', y: 56, n: 1 },
    { role: 'MF', y: 38, n: 2 },
    { role: 'FW', y: 20, n: 1 },
  ]),
];

// ─────────────────────────────────────────────────────────────────────────────
// F8 — 7 de campo + portero (variante regional, p.ej. Canarias).
// ─────────────────────────────────────────────────────────────────────────────

const F8: Formation[] = [
  build('1-3-3-1', 'F8', [
    { role: 'DF', y: 74, n: 3 },
    { role: 'MF', y: 50, n: 3 },
    { role: 'FW', y: 24, n: 1 },
  ]),
  build('1-3-1-2-1', 'F8', [
    { role: 'DF', y: 76, n: 3 },
    { role: 'MF', y: 58, n: 1 },
    { role: 'MF', y: 40, n: 2 },
    { role: 'FW', y: 20, n: 1 },
  ]),
  build('1-2-3-2', 'F8', [
    { role: 'DF', y: 74, n: 2 },
    { role: 'MF', y: 50, n: 3 },
    { role: 'FW', y: 26, n: 2 },
  ]),
  build('1-4-2-1', 'F8', [
    { role: 'DF', y: 74, n: 4 },
    { role: 'MF', y: 48, n: 2 },
    { role: 'FW', y: 24, n: 1 },
  ]),
];

// ─────────────────────────────────────────────────────────────────────────────
// F11 — 10 de campo + portero.
// ─────────────────────────────────────────────────────────────────────────────

const F11: Formation[] = [
  build('4-4-2', 'F11', [
    { role: 'DF', y: 76, n: 4 },
    { role: 'MF', y: 50, n: 4 },
    { role: 'FW', y: 24, n: 2 },
  ]),
  build('4-3-3', 'F11', [
    { role: 'DF', y: 76, n: 4 },
    { role: 'MF', y: 50, n: 3 },
    { role: 'FW', y: 24, n: 3 },
  ]),
  build('4-2-3-1', 'F11', [
    { role: 'DF', y: 78, n: 4 },
    { role: 'MF', y: 58, n: 2 },
    { role: 'MF', y: 38, n: 3 },
    { role: 'FW', y: 18, n: 1 },
  ]),
  build('3-5-2', 'F11', [
    { role: 'DF', y: 76, n: 3 },
    { role: 'MF', y: 50, n: 5 },
    { role: 'FW', y: 24, n: 2 },
  ]),
  build('4-4-2-rombo', 'F11', [
    { role: 'DF', y: 78, n: 4 },
    { role: 'MF', y: 60, n: 1 },
    { role: 'MF', y: 46, n: 2 },
    { role: 'MF', y: 34, n: 1 },
    { role: 'FW', y: 18, n: 2 },
  ]),
  build('5-3-2', 'F11', [
    { role: 'DF', y: 78, n: 5 },
    { role: 'MF', y: 50, n: 3 },
    { role: 'FW', y: 24, n: 2 },
  ]),
  build('3-4-3', 'F11', [
    { role: 'DF', y: 76, n: 3 },
    { role: 'MF', y: 50, n: 4 },
    { role: 'FW', y: 24, n: 3 },
  ]),
];

/** Catálogo completo, indexado por código. */
export const FORMATIONS: readonly Formation[] = [...F7, ...F8, ...F11];

const BY_CODE: ReadonlyMap<string, Formation> = new Map(
  FORMATIONS.map((f) => [f.code, f]),
);

/** Devuelve la formación por código, o undefined si no está en el catálogo. */
export function getFormation(code: string): Formation | undefined {
  return BY_CODE.get(code);
}

/** Formaciones disponibles para una modalidad. */
export function formationsForFormat(format: TeamFormat): Formation[] {
  return FORMATIONS.filter((f) => f.format === format);
}

/** Formación por defecto de cada modalidad (la primera del listado). */
export function defaultFormation(format: TeamFormat): Formation {
  const first = formationsForFormat(format)[0];
  if (!first) throw new Error(`no formations for format ${format}`);
  return first;
}

/** Nombre por defecto de la primera alineación auto-creada (Bug BB). */
export const DEFAULT_LINEUP_NAME = 'Plan A';

/**
 * Defaults para auto-crear el borrador de alineación al entrar a /alineacion sin
 * ninguna previa (Bug BB): "Plan A" + la primera formación del catálogo para la
 * modalidad (F7→1-3-3, F8→1-3-3-1, F11→4-4-2). Sin paso intermedio.
 */
export function defaultLineupDraft(
  format: TeamFormat,
): { name: string; formationCode: string } {
  return { name: DEFAULT_LINEUP_NAME, formationCode: defaultFormation(format).code };
}
