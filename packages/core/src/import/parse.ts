import { PLAYER_IMPORT_COLUMNS, type PlayerImportColumn } from './schema';

/**
 * Mapa de aliases tolerables que mapean a la columna canónica. Cubre
 * variaciones típicas en Excel español: espacios, mayúsculas, acentos en
 * "fecha". El matching se hace contra esta tabla tras lowercase+trim.
 *
 * Cualquier header no mapeado se descarta silenciosamente (spec §5: "columnas
 * extra se ignoran con aviso"). El aviso lo hace la UI a partir del retorno
 * `unmapped_headers`.
 */
const HEADER_ALIASES: Record<string, PlayerImportColumn> = {
  first_name: 'first_name',
  nombre: 'first_name',
  'first name': 'first_name',
  last_name: 'last_name',
  apellido: 'last_name',
  apellidos: 'last_name',
  'last name': 'last_name',
  date_of_birth: 'date_of_birth',
  dob: 'date_of_birth',
  'fecha nacimiento': 'date_of_birth',
  'fecha de nacimiento': 'date_of_birth',
  fecha_nacimiento: 'date_of_birth',
  dorsal: 'dorsal',
  numero: 'dorsal',
  number: 'dorsal',
  position_main: 'position_main',
  'position main': 'position_main',
  posicion: 'position_main',
  positions_secondary: 'positions_secondary',
  'positions secondary': 'positions_secondary',
  posiciones_secundarias: 'positions_secondary',
  foot: 'foot',
  pie: 'foot',
  height_cm: 'height_cm',
  height: 'height_cm',
  altura: 'height_cm',
  weight_kg: 'weight_kg',
  weight: 'weight_kg',
  peso: 'weight_kg',
  origin: 'origin',
  origen: 'origin',
  procedencia: 'origin',
};

export type ParseTabularError =
  | { code: 'empty_file' }
  | { code: 'no_recognized_headers'; received: string[] };

export type ParsedTabular = {
  rows: Array<Partial<Record<PlayerImportColumn, unknown>>>;
  unmapped_headers: string[];
};

/**
 * Normaliza un header: trim + lowercase. No quita acentos (asumimos que la
 * plantilla viene con los nombres canónicos y solo dejamos pasar aliases
 * exactos del mapa).
 */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

/**
 * Construye el mapa header_raw → columna canónica. Headers desconocidos se
 * dejan fuera; el caller decide cómo avisar al user.
 */
export function mapHeaders(rawHeaders: string[]): {
  mapping: Map<string, PlayerImportColumn>;
  unmapped: string[];
} {
  const mapping = new Map<string, PlayerImportColumn>();
  const unmapped: string[] = [];
  for (const h of rawHeaders) {
    const key = normalizeHeader(h);
    const canonical = HEADER_ALIASES[key];
    if (canonical) {
      mapping.set(h, canonical);
    } else {
      unmapped.push(h);
    }
  }
  return { mapping, unmapped };
}

/**
 * Transforma filas tabulares crudas (objetos `{header: value}` tal como las
 * devolverían papaparse o read-excel-file con `header:true`) en filas con
 * keys canónicas listas para `validateRow`.
 *
 * Edge cases por el spec §7:
 *  - Archivo vacío → `{ code: 'empty_file' }`.
 *  - Sin headers reconocibles → `{ code: 'no_recognized_headers' }`.
 *  - Columnas extra → silencio (anotadas en `unmapped_headers` para la UI).
 */
export function parseTabular(
  rawRows: Array<Record<string, unknown>>
): { ok: true; data: ParsedTabular } | { ok: false; error: ParseTabularError } {
  const firstRow = rawRows[0];
  if (!firstRow) {
    return { ok: false, error: { code: 'empty_file' } };
  }
  const rawHeaders = Object.keys(firstRow);
  const { mapping, unmapped } = mapHeaders(rawHeaders);
  if (mapping.size === 0) {
    return {
      ok: false,
      error: { code: 'no_recognized_headers', received: rawHeaders },
    };
  }

  const rows = rawRows.map((raw) => {
    const out: Partial<Record<PlayerImportColumn, unknown>> = {};
    for (const [rawHeader, canonical] of mapping.entries()) {
      out[canonical] = raw[rawHeader];
    }
    // Aseguramos que todas las columnas existentes en la plantilla aparezcan
    // (aunque sea con undefined) para que el schema Zod las trate como vacías
    // en vez de fallar por shape.
    for (const col of PLAYER_IMPORT_COLUMNS) {
      if (!(col in out)) out[col] = null;
    }
    return out;
  });

  return { ok: true, data: { rows, unmapped_headers: unmapped } };
}
