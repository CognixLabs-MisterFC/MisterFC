#!/usr/bin/env node
/**
 * GUARD DE CENSO — el locale de la app no se le pasa CRUDO a `Intl` (web).
 *
 * POR QUÉ EXISTE. `va` no es un locale de Intl y **no falla**: resuelve en silencio a
 * `en-US`. O sea que quien tiene la web en valenciano llevaba desde siempre leyendo
 * "September 10, 2026" —y `9/10/2026`, con el orden americano— dentro de una pantalla
 * en valenciano. Sin excepción, sin aviso y sin nada en los logs.
 *
 * Y no es que nadie lo supiera: el mapeo estaba escrito TRES veces en el repo
 * (`calendar-utils`, `sesiones/page`, `jugadas/page`) y cubría 10 de los 49 sitios.
 * O sea que esto no se arregla una vez: se olvida fichero a fichero, igual que el
 * teclado de la nativa. De ahí el guard.
 *
 * QUÉ COMPRUEBA, y solo esto:
 *   1. nadie pasa `locale` (ni `props.locale`) directo a `Intl.*`, a un `toLocale*`
 *      ni a `localeCompare`: va envuelto en `intlLocale(...)`;
 *   2. ningún `toLocaleDateString()` / `toLocaleString()` / `toLocaleTimeString()` se
 *      queda SIN argumento — eso no sigue al usuario, sigue al SERVIDOR;
 *   3. el mapeo vive en un solo sitio: `ca-ES` no aparece en ningún otro fichero;
 *   4. nadie usa `useFormatter` / `getFormatter` de next-intl, que formatean con el
 *      locale del CONTEXTO (`va`) y tienen exactamente el mismo agujero, solo que
 *      escondido detrás de un hook;
 *   5. y el censo encuentra ficheros (si el glob se rompe, esto no puede pasar en
 *      verde diciendo que todo está bien).
 *
 * LO QUE NO COMPRUEBA: que el formato elegido sea el correcto para esa pantalla. Un
 * `dateStyle: 'full'` donde cabía un `short` compila y se ve mal. Eso se lee.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WEB = join(ROOT, 'apps', 'web', 'src');
const HELPER = 'lib/intl-locale.ts';
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist']);

function fuentes(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return fuentes(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Líneas de CÓDIGO (fuera los comentarios de bloque y de línea). */
function lineasDeCodigo(texto) {
  return texto.split('\n').map((l, i) => ({ n: i + 1, t: l.trim() }))
    .filter(({ t }) => !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'));
}

const CRUDO = [
  /Intl\.(?:DateTimeFormat|RelativeTimeFormat|NumberFormat|Collator|ListFormat|PluralRules)\s*\(\s*(?:props\.)?locale\b/,
  /\.toLocale[A-Za-z]*\s*\(\s*(?:props\.)?locale\b/,
  /\.localeCompare\s*\([^,)]*,\s*(?:props\.)?locale\b/,
];
const SIN_ARGUMENTO = /\.toLocale(?:Date|Time)?String\s*\(\s*\)/;
const FORMATTER = /\b(?:useFormatter|getFormatter)\s*\(/;
const MAPA_SUELTO = /'ca-ES/;

const problemas = [];
const ficheros = fuentes(WEB);
let conIntl = 0;

for (const ruta of ficheros) {
  const rel = relative(WEB, ruta).split('\\').join('/');
  const texto = readFileSync(ruta, 'utf8');
  const lineas = lineasDeCodigo(texto);
  if (/Intl\.|toLocale/.test(texto)) conIntl += 1;

  for (const { n, t } of lineas) {
    if (CRUDO.some((re) => re.test(t))) {
      problemas.push(`${rel}:${n} pasa el locale CRUDO → envuélvelo: intlLocale(locale)`);
    }
    if (SIN_ARGUMENTO.test(t)) {
      problemas.push(`${rel}:${n} formatea SIN locale → sigue al servidor, no al usuario`);
    }
    if (FORMATTER.test(t)) {
      problemas.push(
        `${rel}:${n} usa el formatter de next-intl → formatea con el locale del contexto ('va')`,
      );
    }
    if (rel !== HELPER && MAPA_SUELTO.test(t)) {
      problemas.push(`${rel}:${n} lleva su propio mapeo de locale → usa @/lib/intl-locale`);
    }
  }
}

if (ficheros.length < 100 || conIntl < 10) {
  problemas.push(
    `el censo apenas ha encontrado nada (${ficheros.length} fuentes, ${conIntl} con Intl): ` +
      'el recorrido está roto y este guard no está comprobando nada',
  );
}

if (problemas.length > 0) {
  console.error('\n[intl] El locale llega crudo a Intl en algún sitio:\n');
  for (const p of problemas) console.error('  ' + p);
  console.error(
    "\n  `va` no es un locale de Intl y NO falla: cae a en-US en silencio, así que el\n" +
      '  síntoma es una fecha en inglés que solo ve quien tiene la web en valenciano.\n' +
      '  El mapeo está en apps/web/src/lib/intl-locale.ts.\n',
  );
  process.exit(1);
}

console.log(
  `[intl] OK — ${ficheros.length} fuentes de la web revisadas, ${conIntl} formatean con Intl y ` +
    'ninguna pasa el locale crudo.',
);
