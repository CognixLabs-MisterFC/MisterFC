#!/usr/bin/env node
/**
 * GUARD — quien ofrece ARRANCAR un partido tiene que preguntar si ha empezado, y
 * preguntarlo en el único sitio donde está escrita la respuesta.
 *
 * POR QUÉ EXISTE, y no es una hipótesis. Hasta hoy la pregunta estaba escrita dos
 * veces y de dos maneras:
 *
 *   · web  (`match-clock.tsx`)  → `periods.length > 0 && status !== 'not_started'`
 *   · app  (`screens/staff/directo.tsx`) → `status === 'not_started'`
 *
 * Con un partido en `match_state.status = 'live'` y CERO filas en `match_periods`
 * —el arranque a medias que cerró #801— las dos daban respuestas distintas: la web
 * ofrecía «Iniciar partido» (que además lo repara, porque `startMatchFromClient` es
 * idempotente) y la app no ofrecía NADA. El entrenador se quedó con una tarjeta de
 * reloj vacía y un partido que no se podía empezar. Pasó en producción el
 * 2026-10-16 y lo descubrió Jose probando el APK, no un test.
 *
 * QUÉ PONE ROJO:
 *   · un fichero de PANTALLA (.tsx) que invoca el arranque del partido
 *     (`startMatch…`) y no nombra `matchHasStarted`;
 *   · una pantalla que decide por la columna (`status === 'not_started'` o
 *     `status !== 'not_started'`): esa comparación es la copia que se desincronizó;
 *   · un barrido que no encuentre las DOS superficies → el lector se ha roto y este
 *     guard estaría pasando por vacío.
 *
 * Lo que NO comprueba: que la respuesta se USE para pintar el botón. Eso lo
 * sostienen el test de `matchHasStarted` (core) y abrir la pantalla.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ARBOLES = ['apps/web/src', 'apps/native/src'];

/**
 * Las dos escrituras que PUEDEN crear el reloj de un partido: arrancarlo y
 * reconstruir el acta. Se busca el IDENTIFICADOR, no la llamada: la app pasa
 * `run(startMatchFromClient, ref)` por referencia, y la primera versión de este
 * guard —que exigía un `(` detrás— no vio la pantalla del móvil, que es
 * precisamente la que tenía el fallo. Lo cazó el control positivo de abajo.
 */
const ARRANCA = /\b(startMatch(FromClient)?|prepareMatchSheet(FromClient)?)\b/;
/**
 * La pregunta compartida, LLAMADA. El paréntesis no es un detalle de estilo: con
 * `/\bmatchHasStarted\b/` a secas, el `import { matchHasStarted }` ya satisfacía
 * la comprobación, y al revertir una pantalla a su condición escrita a mano el
 * guard seguía verde. Es la tercera vez en dos días que una afirmación de que algo
 * SE USA se cumple con que el nombre APAREZCA (la anterior, el test de la ficha en
 * #826). Medido: con esta línea en su versión floja, la mutación de la entrada
 * rápida de la web pasaba.
 */
const PREGUNTA = /\bmatchHasStarted\s*\(/;
/**
 * Decidir por la COLUMNA: la copia que se desincronizó. El nombre de la variable
 * cambia por pantalla —`status` en unas, `matchStatus` en la entrada rápida de la
 * web—, así que el patrón admite prefijo y no distingue mayúsculas en la S. Sin
 * eso, la mitad de los sitios podían volver a la mano sin que esto se enterara.
 */
const POR_LA_COLUMNA = /\b\w*[Ss]tatus\s*[!=]==\s*'not_started'/;

/**
 * Los COMENTARIOS fuera antes de buscar nada.
 *
 * Sin esto, el guard se pone rojo contra la frase que EXPLICA el fallo: el
 * comentario que dice «antes esto miraba `status === 'not_started'`» casa el
 * patrón igual que el código. Ya pasó en #826 con un test de la ficha, y volvió a
 * pasar aquí a los diez minutos de escribir esto. Un centinela que obliga a no
 * escribir por qué se arregló algo es peor que no tenerlo.
 */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function ficheros(dir) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (e === 'node_modules' || e === '__tests__') continue;
      out.push(...ficheros(rel));
    } else if (e.endsWith('.tsx') && !e.endsWith('.test.tsx')) {
      out.push(rel);
    }
  }
  return out;
}

const problemas = [];
const superficies = [];

for (const arbol of ARBOLES) {
  for (const rel of ficheros(arbol)) {
    const src = sinComentarios(readFileSync(join(ROOT, rel), 'utf8'));
    if (!ARRANCA.test(src)) continue;
    superficies.push(rel);
    if (!PREGUNTA.test(src)) {
      problemas.push(
        `· ${rel} — crea el reloj de un partido y no usa \`matchHasStarted\`. ` +
          `Si decide por su cuenta, acabará discrepando de la otra pantalla: con el ` +
          `partido en 'live' sin periodos, una ofrecía el botón que lo repara y la ` +
          `otra dejaba el reloj sin un solo control.`,
      );
    }
    if (POR_LA_COLUMNA.test(src)) {
      problemas.push(
        `· ${rel} — decide con \`status === 'not_started'\`. Esa columna no sabe si ` +
          `el reloj existe: usa \`matchHasStarted(periods, status)\`, que mira las dos ` +
          `cosas.`,
      );
    }
  }
}

// CONTROL POSITIVO, y aquí no es un adorno: la PRIMERA versión de este guard
// encontró UNA superficie en vez de tres, porque su patrón exigía un paréntesis y
// la app pasa el escritor por referencia. O sea que el guard habría pasado en verde
// sin haber mirado nunca la pantalla del fallo.
//
// Son CUATRO las superficies que pueden crear el reloj: el control del directo en
// web y en app, y la carga manual del acta en las dos (que siembra los periodos).
// Al escribir esto se creía que eran dos; el barrido encontró las otras dos, cada
// una con su propia forma de preguntar lo mismo.
if (superficies.length < 4) {
  problemas.push(
    `· el barrido encontró ${superficies.length} superficie(s) que crean el reloj de ` +
      `un partido, y hay tres: el control del directo en web y en app, y la carga ` +
      `manual del acta. El lector se ha roto: arregla el patrón antes de fiarte de ` +
      `este verde.`,
  );
}

if (problemas.length > 0) {
  console.error('\n[arranque] La pregunta «¿ha empezado?» vuelve a estar escrita dos veces:\n');
  for (const p of problemas) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `✓ check:arranque-del-partido — ${superficies.length} superficies crean el reloj ` +
    `de un partido y todas preguntan por matchHasStarted: ${superficies.join(', ')}.`,
);
