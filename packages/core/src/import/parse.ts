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
  // first_name — SOLO el nombre. La plantilla trae `Nombre` y `Apellidos` en
  // columnas separadas desde 2026-09: lo que venga aquí se guarda tal cual, sin
  // partirlo por espacios. Ver FULL_NAME_HEADERS para la plantilla vieja.
  nombre: 'first_name',
  nombres: 'first_name',
  first_name: 'first_name',
  'first name': 'first_name',
  firstname: 'first_name',
  name: 'first_name',
  // first_name — valencià (O2-12a importador multiidioma).
  nom: 'first_name',
  noms: 'first_name',
  // last_name (opcional, ver F2.9 hotfix 2026-05-30: hay quien solo tiene nombre)
  apellido: 'last_name',
  apellidos: 'last_name',
  last_name: 'last_name',
  'last name': 'last_name',
  'last names': 'last_name',
  lastname: 'last_name',
  surname: 'last_name',
  surnames: 'last_name',
  // last_name — valencià.
  cognom: 'last_name',
  cognoms: 'last_name',
  // date_of_birth
  'fecha de nacimiento': 'date_of_birth',
  'fecha nacimiento': 'date_of_birth',
  nacimiento: 'date_of_birth',
  'f nacimiento': 'date_of_birth',
  fecha_nacimiento: 'date_of_birth',
  date_of_birth: 'date_of_birth',
  'date of birth': 'date_of_birth',
  birthdate: 'date_of_birth',
  birthday: 'date_of_birth',
  dob: 'date_of_birth',
  // date_of_birth — valencià (O2-12a importador multiidioma).
  'data de naixement': 'date_of_birth',
  'data naixement': 'date_of_birth',
  naixement: 'date_of_birth',
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
  // team — valencià (O2-12a importador multiidioma).
  equip: 'team',
  // invite_email (Rework A · A5, 🔒 O2) — email de contacto/invitación.
  email: 'invite_email',
  correo: 'invite_email',
  'correo electronico': 'invite_email',
  'e-mail': 'invite_email',
  'email address': 'invite_email',
  'email familiar': 'invite_email',
  'email de contacto': 'invite_email',
  'email contacto': 'invite_email',
  invite_email: 'invite_email',
  // invite_email — valencià (O2-12a importador multiidioma).
  correu: 'invite_email',
  'correu electronic': 'invite_email',
};

/**
 * Cabeceras de NOMBRE COMPLETO — la plantilla de 2026-07, que pedía nombre y
 * apellidos en una sola celda.
 *
 * No se mapean: se RECHAZA el fichero entero. Partir "Pepe Gómez García" por
 * espacios es adivinar, y con "Juan Carlos Pérez García" se adivina mal; dejarlo
 * entero en `first_name` es lo que dejó fichas con el apellido vacío y rompió la
 * detección de duplicados, que compara (nombre, apellidos, fecha). Entre adivinar
 * y no importar, no se importa: quien sube el fichero sabe separar las columnas,
 * y nosotros no sabemos dónde parte su nombre.
 *
 * Son NUESTRAS cabeceras, no las de nadie: por eso se reconocen con seguridad y
 * el aviso puede decir exactamente qué hacer. Un fichero con `Nombre` a secas y
 * sin `Apellidos` NO cae aquí — se importa, y `last_name` queda vacío, que es un
 * caso legítimo desde el hotfix F2.9.
 */
const FULL_NAME_HEADERS = new Set([
  'nombre completo',
  'nombre y apellidos',
  'full name',
  'fullname',
  'full name and surname',
  'name and surname',
  'nom complet',
  'nom i cognoms',
]);

export type ParseTabularError =
  | { code: 'empty_file' }
  | { code: 'no_recognized_headers'; received: string[] }
  | { code: 'old_template'; header: string };

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
  /** Cabecera de NOMBRE COMPLETO encontrada (plantilla vieja), tal cual venía. */
  fullNameHeader: string | null;
} {
  const mapping = new Map<string, PlayerImportColumn>();
  const unmapped: string[] = [];
  let fullNameHeader: string | null = null;
  for (const h of rawHeaders) {
    const folded = foldHeader(h);
    if (FULL_NAME_HEADERS.has(folded)) {
      // La primera que aparezca es la que se nombra en el aviso.
      fullNameHeader ??= h;
      continue;
    }
    const canonical = HEADER_ALIASES[folded];
    if (canonical) {
      mapping.set(h, canonical);
    } else {
      unmapped.push(h);
    }
  }
  return { mapping, unmapped, fullNameHeader };
}

/**
 * Transforma filas tabulares crudas (objetos `{header: value}` tal como las
 * devuelve papaparse o read-excel-file con `header:true`) en filas con keys
 * canónicas listas para `validateRow`.
 *
 * Edge cases per spec §7:
 *  - Archivo vacío → `{ code: 'empty_file' }`.
 *  - Plantilla vieja (columna de nombre completo) → `{ code: 'old_template' }`.
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
  const { mapping, unmapped, fullNameHeader } = mapHeaders(rawHeaders);
  // La plantilla vieja se rechaza ENTERA, y antes que nada: el fichero puede
  // traer también `Fecha de nacimiento` y `Email`, así que `mapping` no estaría
  // vacío y el import seguiría adelante sin nombre. Ver FULL_NAME_HEADERS.
  if (fullNameHeader !== null) {
    return { ok: false, error: { code: 'old_template', header: fullNameHeader } };
  }
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
