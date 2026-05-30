// Genera apps/web/public/import-templates/players-template.{csv,xlsx} con
// los headers castellanos del hotfix F2.9 2026-05-30 y una segunda hoja
// "Valores aceptados" con los enums bilingües.
//
// Uso (regenerar cuando cambien headers/enums):
//   node scripts/generate-import-template.mjs

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import writeXlsxFile from 'write-excel-file/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../apps/web/public/import-templates');

// Headers en castellano. Las dos primeras llevan asterisco — son las únicas
// obligatorias (parte C del hotfix). El parser los acepta con o sin
// asterisco vía foldHeader.
const HEADERS = [
  'Nombre*',
  'Apellidos',
  'Fecha de nacimiento*',
  'Dorsal',
  'Posición',
  'Posiciones secundarias',
  'Pie dominante',
  'Altura (cm)',
  'Peso (kg)',
  'Procedencia',
];

// Filas de ejemplo (cubren los casos del smoke plan).
const SAMPLE_ROWS = [
  ['Pepe', 'Gómez García', '15/03/2010', '10', 'Mediocentro', 'Defensa|Delantero', 'Derecho', '150', '42,5', 'Cantera'],
  ['Lucía', 'Sánchez López', '03/09/2011', '7', 'Delantero', '', 'Izquierdo', '148', '40', ''],
  ['Solo Nombre', '', '20/01/2012', '', '', '', '', '', '', ''], // solo obligatorios
  ['Ana', '', '14/07/2013', '5', 'Portero', '', 'Derecho', '', '', ''], // sin apellidos pero con datos
];

// ─────────────────────── CSV ───────────────────────

function escapeCsvCell(v) {
  const s = String(v ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv() {
  const lines = [HEADERS.map(escapeCsvCell).join(',')];
  for (const row of SAMPLE_ROWS) lines.push(row.map(escapeCsvCell).join(','));
  return lines.join('\n');
}

await writeFile(resolve(OUT_DIR, 'players-template.csv'), buildCsv(), 'utf8');
console.log('✓ CSV generado');

// ─────────────────────── XLSX ───────────────────────
//
// write-excel-file/node usa un schema declarativo. Lo armamos por hoja.

const HEADER_STYLE = {
  fontWeight: 'bold',
  backgroundColor: '#1f2937',
  color: '#f3f4f6',
  alignVertical: 'center',
  borderColor: '#374151',
};

const REQUIRED_HEADER_STYLE = {
  ...HEADER_STYLE,
  backgroundColor: '#065f46', // verde oscuro para destacar obligatorios
};

const REQUIRED_COLS = new Set(['Nombre*', 'Fecha de nacimiento*']);

const sheetPlayers = [
  HEADERS.map((h) => ({
    value: h,
    ...(REQUIRED_COLS.has(h) ? REQUIRED_HEADER_STYLE : HEADER_STYLE),
  })),
  ...SAMPLE_ROWS.map((row) =>
    row.map((v) => ({ value: v == null || v === '' ? null : String(v) }))
  ),
];

// ────── Hoja "Valores aceptados" ──────

const VALORES_ROWS = [
  [{ value: 'Campo', fontWeight: 'bold' }, { value: 'Valores aceptados (castellano + retro-compat inglés + sinónimos)', fontWeight: 'bold' }],
  [
    { value: 'Posición' },
    { value: 'Portero · Defensa · Lateral · Central · Mediocentro · Centrocampista · Mediocampista · Pivote · Delantero · Extremo · Punta · Ariete' },
  ],
  [
    { value: '' },
    { value: 'Retro-compat: goalkeeper, defender, midfielder, forward' },
  ],
  [
    { value: 'Pie dominante' },
    { value: 'Derecho · Izquierdo · Ambidiestro · Zurdo · Diestro' },
  ],
  [
    { value: '' },
    { value: 'Retro-compat: right, left, both' },
  ],
  [
    { value: 'Fecha de nacimiento' },
    { value: 'Formato preferido: dd/mm/yyyy (ej. 15/03/2010). También aceptamos dd-mm-yyyy, yyyy-mm-dd, o celda Excel marcada como Date.' },
  ],
  [
    { value: 'Dorsal' },
    { value: 'Número entero entre 1 y 99' },
  ],
  [
    { value: 'Altura (cm)' },
    { value: 'Entero entre 50 y 250' },
  ],
  [
    { value: 'Peso (kg)' },
    { value: 'Número entre 10 y 200. Acepta coma o punto decimal (72,5 o 72.5).' },
  ],
];

await writeXlsxFile([
  { name: 'jugadores', data: sheetPlayers },
  { name: 'Valores aceptados', data: VALORES_ROWS },
]).toFile(resolve(OUT_DIR, 'players-template.xlsx'));
console.log('✓ XLSX generado con 2 hojas (jugadores + valores aceptados)');
