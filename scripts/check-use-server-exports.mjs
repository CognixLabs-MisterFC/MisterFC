#!/usr/bin/env node
/**
 * Guard de CI: un fichero 'use server' (Server Actions) SOLO puede exportar
 * FUNCIONES ASYNC. Exportar un valor (const/objeto/array/clase/enum) o una función
 * síncrona rompe la ruta EN RUNTIME —no en el build— con:
 *   "A "use server" file can only export async functions, found object"
 * (p.ej. /es/cuerpo-tecnico petó al exportar `STAFF_CLUB_ROLES` desde actions.ts).
 * `next build` compila igual, así que este error no lo caza ni typecheck ni lint;
 * este script sí, de forma estática.
 *
 * Regla: en un fichero cuya PRIMERA sentencia es la directiva 'use server', cada
 * `export` de nivel superior debe ser `export async function` (o `export default
 * async function`) o un tipo (`export type` / `export interface`, que se borran en
 * compilación). Cualquier otro export —const/let/var/class/enum, función síncrona,
 * default no-async, o re-export `export {…}` / `export *`— se marca.
 *
 * Uso: node scripts/check-use-server-exports.mjs  (exit 1 si hay infracciones).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/web/src';
const exts = ['.ts', '.tsx'];

/** Recorre recursivamente ROOT y devuelve los ficheros .ts/.tsx. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out.push(...walk(p));
    } else if (exts.some((e) => p.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

/** ¿La PRIMERA sentencia del fichero es la directiva 'use server'? (saltando comentarios). */
function isUseServer(src) {
  let inBlock = false;
  for (let raw of src.split('\n')) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2).trim();
      inBlock = false;
    }
    if (line === '') continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (line.includes('*/')) {
        line = line.slice(line.indexOf('*/') + 2).trim();
        if (line === '') continue;
      } else {
        inBlock = true;
        continue;
      }
    }
    return /^['"]use server['"];?$/.test(line);
  }
  return false;
}

/** Devuelve los exports de nivel superior que NO son async-function ni type. */
function badExports(src) {
  const bad = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^export\s+(.*)$/.exec(lines[i]);
    if (!m) continue; // solo exports a inicio de línea (nivel superior)
    const decl = m[1].trim();
    const ok =
      decl.startsWith('async function') ||
      decl.startsWith('default async function') ||
      decl.startsWith('type ') ||
      decl.startsWith('interface ') ||
      decl.startsWith('type{') ||
      decl.startsWith('type {');
    if (!ok) bad.push({ line: i + 1, decl: decl.slice(0, 72) });
  }
  return bad;
}

const offenders = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  if (!isUseServer(src)) continue;
  const bad = badExports(src);
  for (const b of bad) offenders.push({ file, ...b });
}

if (offenders.length > 0) {
  console.error(
    '\n❌ Ficheros "use server" con exports que NO son funciones async ' +
      '(romperían la ruta en runtime):\n',
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  →  export ${o.decl}`);
  }
  console.error(
    '\nMueve tipos/constantes/helpers a un fichero SIN "use server" e ' +
      'impórtalos. https://nextjs.org/docs/messages/invalid-use-server-value\n',
  );
  process.exit(1);
}

console.log('✅ Todos los ficheros "use server" exportan solo funciones async.');
