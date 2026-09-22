// Genera apps/web/public/import-templates/players-template{,-en,-va}.{csv,xlsx}.
//
// La plantilla trae EXACTAMENTE 5 columnas — Nombre, Apellidos, Fecha de
// nacimiento, Equipo, Email. Las 6 de detalle (dorsal, posición, pie, altura,
// peso, procedencia) se rellenan en el alta individual, no aquí.
//
// NOMBRE Y APELLIDOS VAN SEPARADOS (2026-09). Antes iban en una sola celda
// ("Nombre completo") y el importador guardaba la celda entera en `first_name`,
// dejando el apellido vacío: eso rompía la detección de duplicados —que compara
// (nombre, apellidos, fecha)— y dejaba fichas con el nombre entero dentro. La
// alternativa, partir por espacios, es adivinar: con "Juan Carlos Pérez García"
// se adivina mal. Se separa en origen y no se adivina nada. Los ficheros de la
// plantilla vieja se RECHAZAN con un aviso (FULL_NAME_HEADERS en core/import).
//
// Los tres idiomas se generan aquí. Antes el script solo hacía el castellano y
// los de en/va estaban a mano desde #445: al cambiar las columnas habrían quedado
// descolgados.
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

// El asterisco marca las OBLIGATORIAS. "Apellidos" NO lo lleva: desde el hotfix
// F2.9 hay fichas legítimas con solo nombre. El parser acepta los headers con o
// sin asterisco (foldHeader lo quita antes del lookup).
const LOCALES = [
  {
    suffix: '',
    headers: ['Nombre*', 'Apellidos', 'Fecha de nacimiento*', 'Equipo', 'Email*'],
    required: ['Nombre*', 'Fecha de nacimiento*', 'Email*'],
    rows: [
      ['Pepe', 'Gómez García', '15/03/2010', 'Infantil A', 'pepe.gomez@example.com'],
      ['Lucía', 'Sánchez López', '03/09/2011', 'Alevín B', 'familia.lucia@example.com'],
      ['Mario', 'Ruiz', '20/01/2012', '', 'mario.ruiz@example.com'],
    ],
    instructionsSheet: 'Instrucciones',
    instructionsHead: ['Columna', 'Cómo rellenarla'],
    instructions: [
      ['Nombre', 'Obligatorio. SOLO el nombre del jugador (ej. "Pepe"). Los apellidos van en su propia columna.'],
      ['Apellidos', 'Opcional. Los apellidos, en su columna (ej. "Gómez García"). Déjala vacía si el jugador solo tiene nombre.'],
      ['Fecha de nacimiento', 'Obligatorio. Formato preferido dd/mm/yyyy (ej. 15/03/2010). También dd-mm-yyyy, yyyy-mm-dd o celda Excel con formato Fecha.'],
      ['Equipo', 'Opcional. Nombre EXACTO de un equipo existente de la temporada activa (ej. "Infantil A"). Si se deja vacío, se usa el equipo elegido en el asistente. Un equipo que no exista da error (la importación no crea equipos).'],
      ['Email', 'Obligatorio. Email de contacto/invitación (ej. "familia@example.com"). Sirve para enviar la invitación tras importar.'],
    ],
  },
  {
    suffix: '-en',
    headers: ['First name*', 'Surname', 'Date of birth*', 'Team', 'Email*'],
    required: ['First name*', 'Date of birth*', 'Email*'],
    rows: [
      ['Pepe', 'Gómez García', '15/03/2010', 'Infantil A', 'pepe.gomez@example.com'],
      ['Lucía', 'Sánchez López', '03/09/2011', 'Alevín B', 'familia.lucia@example.com'],
      ['Mario', 'Ruiz', '20/01/2012', '', 'mario.ruiz@example.com'],
    ],
    instructionsSheet: 'Instructions',
    instructionsHead: ['Column', 'How to fill it in'],
    instructions: [
      ['First name', 'Required. The given name ONLY (e.g. "Pepe"). Surnames go in their own column.'],
      ['Surname', 'Optional. The surnames, in their own column (e.g. "Gómez García"). Leave it empty if the player only has a given name.'],
      ['Date of birth', 'Required. Preferred format dd/mm/yyyy (e.g. 15/03/2010). Also dd-mm-yyyy, yyyy-mm-dd or an Excel cell formatted as Date.'],
      ['Team', 'Optional. The EXACT name of an existing team in the active season (e.g. "Infantil A"). If left empty, the team picked in the wizard is used. A team that does not exist is an error (importing never creates teams).'],
      ['Email', 'Required. Contact/invitation email (e.g. "familia@example.com"). Used to send the invitation after importing.'],
    ],
  },
  {
    suffix: '-va',
    headers: ['Nom*', 'Cognoms', 'Data de naixement*', 'Equip', 'Email*'],
    required: ['Nom*', 'Data de naixement*', 'Email*'],
    rows: [
      ['Pepe', 'Gómez García', '15/03/2010', 'Infantil A', 'pepe.gomez@example.com'],
      ['Lucía', 'Sánchez López', '03/09/2011', 'Alevín B', 'familia.lucia@example.com'],
      ['Mario', 'Ruiz', '20/01/2012', '', 'mario.ruiz@example.com'],
    ],
    instructionsSheet: 'Instruccions',
    instructionsHead: ['Columna', 'Com omplir-la'],
    instructions: [
      ['Nom', 'Obligatori. NOMÉS el nom del jugador (p. ex. "Pepe"). Els cognoms van en la seua pròpia columna.'],
      ['Cognoms', 'Opcional. Els cognoms, en la seua columna (p. ex. "Gómez García"). Deixa-la buida si el jugador només té nom.'],
      ['Data de naixement', 'Obligatori. Format preferit dd/mm/aaaa (p. ex. 15/03/2010). També dd-mm-aaaa, aaaa-mm-dd o cel·la d\'Excel amb format Data.'],
      ['Equip', 'Opcional. Nom EXACTE d\'un equip existent de la temporada activa (p. ex. "Infantil A"). Si es deixa buit, s\'usa l\'equip triat en l\'assistent. Un equip que no existisca dóna error (la importació no crea equips).'],
      ['Email', 'Obligatori. Email de contacte/invitació (p. ex. "familia@example.com"). Serveix per a enviar la invitació després d\'importar.'],
    ],
  },
];

// ─────────────────────── CSV ───────────────────────

function escapeCsvCell(v) {
  const s = String(v ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv({ headers, rows }) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','));
  return lines.join('\n');
}

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

const INSTR_HEADER = { fontWeight: 'bold', backgroundColor: '#e5e7eb' };

for (const locale of LOCALES) {
  const { suffix, headers, required, rows } = locale;
  const requiredSet = new Set(required);

  await writeFile(
    resolve(OUT_DIR, `players-template${suffix}.csv`),
    buildCsv(locale),
    'utf8',
  );

  const sheetPlayers = [
    headers.map((h) => ({
      value: h,
      ...(requiredSet.has(h) ? REQUIRED_HEADER_STYLE : HEADER_STYLE),
    })),
    ...rows.map((row) =>
      row.map((v) => ({ value: v == null || v === '' ? null : String(v) })),
    ),
  ];

  const sheetInstructions = [
    locale.instructionsHead.map((h) => ({ value: h, ...INSTR_HEADER })),
    ...locale.instructions.map(([col, how]) => [
      { value: col, fontWeight: 'bold' },
      { value: how },
    ]),
  ];

  // La hoja de datos se llama SIEMPRE `jugadores`, en los tres idiomas, y va la
  // PRIMERA: `parse-file.ts` la busca por ese nombre y, si no la encuentra, cae a
  // la primera hoja. Traducir el nombre dejaría el fallback como único camino.
  //
  // La opción es `sheet`, no `name`: en write-excel-file v4 `name` se ignora en
  // silencio. Por eso los xlsx de es/va que había en `public/` llevaban las hojas
  // llamadas "Sheet1"/"Sheet2" y vivían del fallback; solo el de inglés, hecho a
  // mano en #445, tenía la hoja `jugadores`.
  await writeXlsxFile([
    { sheet: 'jugadores', data: sheetPlayers },
    { sheet: locale.instructionsSheet, data: sheetInstructions },
  ]).toFile(resolve(OUT_DIR, `players-template${suffix}.xlsx`));

  console.log(`✓ players-template${suffix || ' (es)'} — csv + xlsx`);
}
