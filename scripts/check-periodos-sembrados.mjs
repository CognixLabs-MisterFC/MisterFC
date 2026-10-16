#!/usr/bin/env node
/**
 * GUARD — quien SIEMBRA periodos tiene que saber CUÁNTOS hay.
 *
 * POR QUÉ EXISTE, y no es una hipótesis. Hasta hoy, `prepareMatchSheet` (la acción
 * que reconstruye el acta de un partido que nunca se abrió en el directo) escribía
 * DOS filas de `match_periods` a mano —`first_half` y `second_half`— leyendo solo
 * `categories.half_duration_minutes`. En una categoría de TRES tiempos (querubín)
 * eso sembraba 2 de 3: el reloj total quedaba en 2·12 en vez de 3·12, los minutos
 * jugados salían cortos y un evento del tercer tiempo se guardaba como
 * `second_half`, porque `periodAtClock` se queda con el último periodo que cabe.
 *
 * Lo que lo hace un guard y no un comentario: la migración de los tres tiempos
 * (20261121000000) RETIRÓ a propósito la constante global `PERIOD_ORDER` «para que
 * ningún sitio pueda seguir asumiendo la de dos sin decirlo» — y aquel sitio no la
 * usaba, se la había escrito a mano, donde ninguna retirada la alcanza. Un tipo
 * impide lo que pasa por él; esto vigila lo que lo esquiva.
 *
 * QUÉ PONE ROJO:
 *   · un fichero que inserta en `match_periods` sin nombrar `period_count` ni
 *     `PeriodCount` (es decir: siembra sin saber cuántos);
 *   · un literal `period: 'second_half'` en un insert fuera del motor del reloj;
 *   · un barrido que no encuentre NINGÚN sitio que inserte → el lector se ha roto y
 *     este guard estaría pasando por vacío.
 *
 * Lo que NO comprueba: que el `count` que se lee sea el de la categoría CORRECTA.
 * Eso lo cubren los tests de `reconstructedPeriods` y la lectura del propio sitio.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ARBOLES = ['apps/web/src', 'apps/native/src', 'packages/core/src'];

/** El motor del reloj SÍ puede nombrar los periodos: es donde viven. */
const MOTOR = ['packages/core/src/match/clock.ts', 'packages/core/src/match/phase.ts'];

const INSERTA_PERIODOS = /from\(\s*'match_periods'\s*\)[\s\S]{0,400}?\.insert\(/;
const LITERAL_SEGUNDA = /period:\s*'second_half'/;

/**
 * Lo que cuenta como SABER cuántos periodos hay: que el fichero LEA la columna
 * `period_count` en un `.select(...)`.
 *
 * ── POR QUÉ ASÍ Y NO «QUE MENCIONE period_count» ────────────────────────────
 * Medido en este mismo PR. La primera versión de este guard aceptaba cualquier
 * mención de `period_count`, `PeriodCount`, `reconstructedPeriods` o
 * `buildNextPeriod`. Al mutar la acción para que dejara de leer la columna, el guard
 * siguió VERDE: el fichero todavía nombraba `reconstructedPeriods` y el tipo
 * `PeriodCount`, así que pasaba por una razón que no era la suya. Y con un patrón de
 * `period_count` a secas habría pasado igual, porque lo que quedaba eran los
 * COMENTARIOS que explican el fallo.
 *
 * Usar el helper no es evidencia de leer el dato: se le puede pasar un 2 a mano. La
 * evidencia es la consulta.
 */
function selectsDe(src) {
  const out = [];
  const re = /\.select\(\s*(['"`])([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[2]);
  return out;
}

function leeElCount(src) {
  return selectsDe(src).some((sel) => sel.includes('period_count'));
}

function ficheros(dir) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    const abs = join(ROOT, rel);
    if (statSync(abs).isDirectory()) {
      if (e === 'node_modules' || e === '__tests__') continue;
      out.push(...ficheros(rel));
    } else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) {
      out.push(rel);
    }
  }
  return out;
}

const problemas = [];
const sembradores = [];

for (const arbol of ARBOLES) {
  for (const rel of ficheros(arbol)) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    if (!INSERTA_PERIODOS.test(src)) {
      // Un literal de periodo en un insert, aunque no sea de match_periods, es la
      // forma exacta del fallo que motivó esto.
      if (LITERAL_SEGUNDA.test(src) && !MOTOR.includes(rel)) {
        problemas.push(
          `· ${rel} — escribe \`period: 'second_half'\` a mano. Los periodos de una ` +
            `categoría salen de \`regularPeriods(count)\` / \`reconstructedPeriods\`, ` +
            `no de una lista escrita aquí: en querubín son TRES.`,
        );
      }
      continue;
    }
    sembradores.push(rel);
    if (!leeElCount(src)) {
      problemas.push(
        `· ${rel} — inserta en match_periods y NINGÚN \`.select()\` suyo lee ` +
          `\`period_count\`. Sembrar sin leer cuántos periodos tiene la categoría deja ` +
          `el reloj corto (pasó en prepareMatchSheet: 2 de 3 en querubín). Nombrar el ` +
          `tipo o el helper no cuenta: al helper se le puede pasar un 2 a mano.`,
      );
    }
    if (LITERAL_SEGUNDA.test(src) && !MOTOR.includes(rel)) {
      problemas.push(
        `· ${rel} — siembra con un literal \`period: 'second_half'\`. Usa ` +
          `\`reconstructedPeriods(count, duración)\`, que decide la lista por categoría.`,
      );
    }
  }
}

// CONTROL POSITIVO: si el barrido no encuentra sembradores, este guard no vigila
// nada y su verde es el verde del vacío.
if (sembradores.length < 2) {
  problemas.push(
    `· el barrido encontró ${sembradores.length} sitio(s) que inserten en ` +
      `match_periods, y hay al menos dos (prepareMatchSheet y el arranque del reloj). ` +
      `El lector se ha roto: arregla el patrón antes de fiarte de este verde.`,
  );
}

if (problemas.length > 0) {
  console.error('\n[periodos] Alguien siembra periodos sin saber cuántos hay:\n');
  for (const p of problemas) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `✓ check:periodos-sembrados — ${sembradores.length} sitios siembran periodos y los ` +
    `${sembradores.length} LEEN period_count: ${sembradores.join(', ')}.`,
);
