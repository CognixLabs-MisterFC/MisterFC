// Genera apps/web/public/import-templates/players-template.{csv,xlsx} con la
// plantilla de importación de jugadores REHECHA (2026-07): EXACTAMENTE 4
// columnas — Nombre completo, Fecha de nacimiento, Equipo, Email. Las 7
// columnas de detalle (dorsal, posición, pie, altura, peso, apellidos,
// procedencia) se rellenan en el alta individual, no aquí.
//
// Uso (regenerar cuando cambien headers/estilos):
//   node scripts/generate-import-template.mjs
//   (o `npm run gen:import-template` / `pnpm gen:import-template`)

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import writeXlsxFile from 'write-excel-file/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../apps/web/public/import-templates');

// Headers en castellano. El asterisco marca las OBLIGATORIAS (Nombre completo,
// Fecha de nacimiento, Email). "Equipo" es opcional: si se deja vacío, el
// jugador se sube al equipo elegido en el selector de lote del asistente. El
// parser acepta los headers con o sin asterisco (foldHeader los normaliza).
const HEADERS = ['Nombre completo*', 'Fecha de nacimiento*', 'Equipo', 'Email*'];

const REQUIRED_COLS = new Set([
  'Nombre completo*',
  'Fecha de nacimiento*',
  'Email*',
]);

// Filas de ejemplo (una con equipo, una sin equipo → usará el selector de lote).
const SAMPLE_ROWS = [
  ['Pepe Gómez García', '15/03/2010', 'Infantil A', 'pepe.gomez@example.com'],
  ['Lucía Sánchez López', '03/09/2011', 'Alevín B', 'familia.lucia@example.com'],
  ['Mario Ruiz', '20/01/2012', '', 'mario.ruiz@example.com'],
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
// write-excel-file/node usa un schema declarativo. NOTA IMPORTANTE: esta
// librería RESPETA `backgroundColor` pero IGNORA el color de fuente (`color`),
// dejando siempre el texto en el tema oscuro por defecto (<color theme="1"/>).
// Por eso la cabecera usa FONDO CLARO + texto oscuro (negrita): así se lee.
// El bug histórico "negro sobre negro" venía de poner fondo oscuro confiando en
// un color de fuente claro que la librería descarta.

const HEADER_STYLE = {
  fontWeight: 'bold',
  backgroundColor: '#e5e7eb', // gris claro → el texto oscuro por defecto se lee
  alignVertical: 'center',
  borderColor: '#9ca3af',
};

const REQUIRED_HEADER_STYLE = {
  ...HEADER_STYLE,
  backgroundColor: '#bbf7d0', // verde claro para destacar las obligatorias
};

const sheetPlayers = [
  HEADERS.map((h) => ({
    value: h,
    ...(REQUIRED_COLS.has(h) ? REQUIRED_HEADER_STYLE : HEADER_STYLE),
  })),
  ...SAMPLE_ROWS.map((row) =>
    row.map((v) => ({ value: v == null || v === '' ? null : String(v) }))
  ),
];

// ────── Hoja "Instrucciones" ──────

const INSTR_HEADER = { fontWeight: 'bold', backgroundColor: '#e5e7eb' };

const VALORES_ROWS = [
  [
    { value: 'Columna', ...INSTR_HEADER },
    { value: 'Cómo rellenarla', ...INSTR_HEADER },
  ],
  [
    { value: 'Nombre completo', fontWeight: 'bold' },
    { value: 'Obligatorio. Nombre y apellidos del jugador en una sola celda (ej. "Pepe Gómez García").' },
  ],
  [
    { value: 'Fecha de nacimiento', fontWeight: 'bold' },
    { value: 'Obligatorio. Formato preferido dd/mm/yyyy (ej. 15/03/2010). También dd-mm-yyyy, yyyy-mm-dd o celda Excel con formato Fecha.' },
  ],
  [
    { value: 'Equipo', fontWeight: 'bold' },
    { value: 'Opcional. Nombre EXACTO de un equipo existente de la temporada activa (ej. "Infantil A"). Si se deja vacío, se usa el equipo elegido en el asistente. Un equipo que no exista da error (la importación no crea equipos).' },
  ],
  [
    { value: 'Email', fontWeight: 'bold' },
    { value: 'Obligatorio. Email de contacto/invitación (ej. "familia@example.com"). Sirve para enviar la invitación tras importar.' },
  ],
];

await writeXlsxFile([
  { name: 'jugadores', data: sheetPlayers },
  { name: 'Instrucciones', data: VALORES_ROWS },
]).toFile(resolve(OUT_DIR, 'players-template.xlsx'));
console.log('✓ XLSX generado con 2 hojas (jugadores + instrucciones)');
