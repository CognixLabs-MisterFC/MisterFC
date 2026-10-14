#!/usr/bin/env node
/**
 * GUARD — la importación de partidos federados es SOLO del superadmin.
 *
 * POR QUÉ EXISTE: la decisión del 14-10-2026 cambió la puerta de «admin_club o
 * director del club activo» a «`is_superadmin()`». La regla en sí vive en core
 * (`ffcv/permiso.ts`) y está medida con tests y mutación; lo que NO se puede
 * medir con un test es el CABLEADO, porque `apps/web` no tiene suite. Y el
 * cableado es justo donde esto se deshace:
 *
 *   permisoImportarFfcv({ ..., esSuperadmin: rol === 'admin_club' })
 *
 * Eso compila, pasa el typecheck, y devuelve la puerta vieja. Nada se pone rojo.
 *
 * QUÉ COMPRUEBA
 *   1. CENSO de entradas: las puertas de la importación son exactamente las que
 *      están aquí declaradas. Si aparece una ruta nueva bajo api/ffcv, falla y
 *      obliga a mirar su puerta antes de mergear.
 *   2. El fichero de la puerta pregunta `is_superadmin` y usa la regla de core.
 *   3. El fichero de la puerta NO lee el rol del club activo ni nombra los roles
 *      que antes pasaban. Esto es lo que impide el ejemplo de arriba.
 *   4. El botón del Calendario tampoco se decide por el rol.
 *
 * NO comprueba que la puerta sea correcta —eso lo hacen los tests de core—:
 * comprueba que nadie la vuelve a abrir al rol sin que un humano lo vea.
 *
 * El control positivo del final no se puede quitar: si el lector se rompiera y
 * leyera cadenas vacías, todo lo de arriba pasaría sin comprobar nada.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fallos = [];

/** La puerta: el ÚNICO sitio que decide si la importación sigue adelante. */
const PUERTA = 'apps/web/src/lib/ffcv-importar.ts';
/** El botón, que solo esconde (la puerta de verdad es PUERTA). */
const BOTON = 'apps/web/src/app/[locale]/(authenticated)/calendario/page.tsx';
/** Censo de rutas HTTP de la importación. Añadir una exige tocar este censo. */
const RUTAS = ['preparar', 'importar-equipo'];

const leer = (rel) => {
  const p = join(RAIZ, rel);
  if (!existsSync(p)) {
    fallos.push(`no existe: ${rel}`);
    return '';
  }
  return readFileSync(p, 'utf8');
};

/** Quita comentarios de línea para no leer un ejemplo de una cabecera como código. */
const sinComentarios = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

// ── 1. CENSO DE RUTAS ────────────────────────────────────────────────────────
const dirRutas = join(RAIZ, 'apps/web/src/app/api/ffcv');
const encontradas = existsSync(dirRutas)
  ? readdirSync(dirRutas, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  : [];
if (encontradas.join(',') !== [...RUTAS].sort().join(',')) {
  fallos.push(
    `el censo de rutas no cuadra: declaradas [${[...RUTAS].sort()}], encontradas [${encontradas}]. ` +
      `Si has añadido una ruta, comprueba que pasa por contextoFfcv y añádela al censo.`,
  );
}

// ── 2 y 3. LA PUERTA ─────────────────────────────────────────────────────────
const puerta = leer(PUERTA);
const puertaCodigo = sinComentarios(puerta);

if (!puertaCodigo.includes('is_superadmin')) {
  fallos.push(`${PUERTA}: la puerta no pregunta is_superadmin().`);
}
if (!puertaCodigo.includes('permisoImportarFfcv')) {
  fallos.push(`${PUERTA}: la puerta no usa permisoImportarFfcv (la regla de core).`);
}
for (const prohibido of ['activeClub.role', "'director'", "'admin_club'"]) {
  if (puertaCodigo.includes(prohibido)) {
    fallos.push(
      `${PUERTA}: aparece ${prohibido}. La importación NO se decide por el rol del ` +
        `club: un superadmin de visita viaja con role 'admin_club' sintético (F14B-8), ` +
        `así que por el rol no se le distingue del admin de ese club.`,
    );
  }
}

// ── 4. EL BOTÓN ──────────────────────────────────────────────────────────────
const boton = sinComentarios(leer(BOTON));
const lineaBoton = boton.split('\n').find((l) => l.includes('canImportFfcv ='));
if (!lineaBoton) {
  fallos.push(`${BOTON}: no se encuentra la asignación de canImportFfcv.`);
} else if (!lineaBoton.includes('loadIsSuperadmin')) {
  fallos.push(
    `${BOTON}: canImportFfcv no sale de loadIsSuperadmin (es: ${lineaBoton.trim()}).`,
  );
}

// ── CONTROL POSITIVO ─────────────────────────────────────────────────────────
// Sin esto, un lector roto que devuelva '' deja pasar los cuatro bloques.
if (puerta.length < 500 || boton.length < 500 || encontradas.length === 0) {
  fallos.push(
    'CONTROL POSITIVO: el lector no ha leído los ficheros esperados ' +
      `(puerta=${puerta.length} b, boton=${boton.length} b, rutas=${encontradas.length}). ` +
      'Los bloques de arriba NO han comprobado nada.',
  );
}
if (!sinComentarios("// esto es un comentario\nconst x = 1;").includes('const x')) {
  fallos.push('CONTROL POSITIVO: el filtro de comentarios se ha comido el código.');
}
if (sinComentarios("// const x = 1;").includes('const x')) {
  fallos.push('CONTROL POSITIVO: el filtro de comentarios no filtra.');
}

if (fallos.length > 0) {
  console.error('[ffcv-superadmin] FALLA:');
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(
  `[ffcv-superadmin] OK — ${encontradas.length} rutas censadas; la puerta pregunta ` +
    'is_superadmin() y no mira el rol; el botón sale de loadIsSuperadmin.',
);
