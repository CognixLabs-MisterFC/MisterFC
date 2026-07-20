import { PLAYER_IMPORT_COLUMNS, type PlayerImportColumn } from './schema';

/**
 * Mapa de aliases de headers (castellano primario + retro-compat inglés).
 * Las claves son la versión "folded" del header: lowercase, sin acentos,
 * espacios colapsados a un solo espacio. Eso cubre las variaciones típicas
 * en plantillas de clubs (mayúsculas, tildes, espacios extra).
 *
 * El asterisco final ("Nombre*", "Fecha de nacimiento*") que la plantilla
 * castellana usa para marcar obligatorios se quita en `foldHeader` antes
 * del lookup.
 *
 * Headers no mapeados → `unmapped_headers` (la UI los avisa pero el import
 * sigue).
 */
const HEADER_ALIASES: Record<string, PlayerImportColumn> = {
  // first_name — la plantilla nueva (2026-07) usa "Nombre completo" (nombre +
  // apellidos en una sola celda); mantenemos "Nombre" y variantes por compat.
  'nombre completo': 'first_name',
  'nombre y apellidos': 'first_name',
  nombre: 'first_name',
  nombres: 'first_name',
  'full name': 'first_name',
  fullname: 'first_name',
  first_name: 'first_name',
  'first name': 'first_name',
  firstname: 'first_name',
  // last_name (ahora opcional, ver F2.9 hotfix 2026-05-30)
  apellido: 'last_name',
  apellidos: 'last_name',
  last_name: 'last_name',
  'last name': 'last_name',
  lastname: 'last_name',
  // date_of_birth
  'fecha de nacimiento': 'date_of_birth',
  'fecha nacimiento': 'date_of_birth',
  nacimiento: 'date_of_birth',
  'f nacimiento': 'date_of_birth',
  fecha_nacimiento: 'date_of_birth',
  date_of_birth: 'date_of_birth',
  'date of birth': 'date_of_birth',
  dob: 'date_of_birth',
  // dorsal
  dorsal: 'dorsal',
  numero: 'dorsal',
  número: 'dorsal',
  'numero de camiseta': 'dorsal',
  'número de camiseta': 'dorsal',
  number: 'dorsal',
  jersey: 'dorsal',
  // position_main
  posicion: 'position_main',
  posición: 'position_main',
  'posicion principal': 'position_main',
  'posición principal': 'position_main',
  position_main: 'position_main',
  'position main': 'position_main',
  position: 'position_main',
  // positions_secondary
  'posiciones secundarias': 'positions_secondary',
  posiciones_secundarias: 'positions_secondary',
  'otras posiciones': 'positions_secondary',
  positions_secondary: 'positions_secondary',
  'positions secondary': 'positions_secondary',
  // foot
  'pie dominante': 'foot',
  'pie habil': 'foot',
  'pie hábil': 'foot',
  pie: 'foot',
  foot: 'foot',
  // height_cm
  'altura cm': 'height_cm',
  altura: 'height_cm',
  estatura: 'height_cm',
  height: 'height_cm',
  height_cm: 'height_cm',
  // weight_kg
  'peso kg': 'weight_kg',
  peso: 'weight_kg',
  weight: 'weight_kg',
  weight_kg: 'weight_kg',
  // origin
  procedencia: 'origin',
  origen: 'origin',
  'club anterior': 'origin',
  origin: 'origin',
  // team (Rework A · A5) — nombre del equipo por fila.
  equipo: 'team',
  'equipo destino': 'team',
  'equipo asignado': 'team',
  team: 'team',
  'team name': 'team',
  // invite_email (Rework A · A5, 🔒 O2) — email de contacto/invitación.
  email: 'invite_email',
  correo: 'invite_email',
  'correo electronico': 'invite_email',
  'e-mail': 'invite_email',
  'email familiar': 'invite_email',
  'email de contacto': 'invite_email',
  'email contacto': 'invite_email',
  invite_email: 'invite_email',
};

export type ParseTabularError =
  | { code: 'empty_file' }
  | { code: 'no_recognized_headers'; received: string[] };

export type ParsedTabular = {
  rows: Array<Partial<Record<PlayerImportColumn, unknown>>>;
  unmapped_headers: string[];
};

/**
 * Folding de header para el lookup tolerante.
 *  - Quita NFD diacríticos.
 *  - Lowercase.
 *  - Trim.
 *  - Colapsa whitespace múltiple a uno.
 *  - Quita el asterisco final que la plantilla castellana usa como marca de
 *    obligatorio ("Nombre*" → "nombre").
 */
function foldHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\*+$/, '')
    .trim();
}

/**
 * Construye el mapa header_raw → columna canónica. Tolerante a tildes,
 * mayúsculas y espacios. Headers desconocidos se devuelven en `unmapped`.
 */
export function mapHeaders(rawHeaders: string[]): {
  mapping: Map<string, PlayerImportColumn>;
  unmapped: string[];
} {
  const mapping = new Map<string, PlayerImportColumn>();
  const unmapped: string[] = [];
  for (const h of rawHeaders) {
    const folded = foldHeader(h);
    const canonical = HEADER_ALIASES[folded];
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
 * devuelve papaparse o read-excel-file con `header:true`) en filas con keys
 * canónicas listas para `validateRow`.
 *
 * Edge cases per spec §7:
 *  - Archivo vacío → `{ code: 'empty_file' }`.
 *  - Sin headers reconocibles → `{ code: 'no_recognized_headers' }`.
 *  - Columnas extra → silencio (anotadas en `unmapped_headers`).
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
    // Aseguramos que todas las columnas conocidas aparezcan (al menos como
    // null) para que el schema Zod las trate como vacías en vez de fallar
    // por shape.
    for (const col of PLAYER_IMPORT_COLUMNS) {
      if (!(col in out)) out[col] = null;
    }
    return out;
  });

  return { ok: true, data: { rows, unmapped_headers: unmapped } };
}
