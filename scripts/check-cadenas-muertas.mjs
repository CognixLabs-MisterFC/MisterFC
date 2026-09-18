#!/usr/bin/env node
/**
 * GUARD DE CENSO — cadenas del catálogo que NADIE usa.
 *
 * POR QUÉ EXISTE: una clave que se queda sin uso no rompe nada. No da error de tipos
 * (los mensajes de next-intl no están tipados), no da error de lint, y el traductor la
 * sigue traduciendo a tres idiomas cada vez que se toca. Se acumulan en silencio: al
 * escribir este guard había 57, y tres de ellas eran de una pantalla que se rehízo
 * hace meses. Nadie las iba a encontrar mirando.
 *
 * CÓMO DECIDE SI UNA CLAVE SE USA. Dos vías, y la segunda es la importante:
 *
 *  1. LITERAL — su último segmento aparece como identificador en el código, o su ruta
 *     completa aparece tal cual. Cubre `t('informe.download_title')` y también
 *     `useTranslations('informe')` + `t('download_title')`, que es lo normal.
 *
 *  2. PLANTILLA — el código pide la clave armándola: `t(`status_${row.status}`)`. Esa
 *     clave no aparece escrita EN NINGUNA PARTE y sin esta vía saldría como muerta. Se
 *     extraen las plantillas de las llamadas de traducción (identificador que empieza
 *     por 't': `t`, `tInf`, `tPos`…), se convierten en expresión regular (cada `${…}`
 *     pasa a `.*`) y la clave cuenta como usada si encaja en alguna.
 *
 *     Se exige que la plantilla tenga al menos 4 caracteres literales: una toda hueco
 *     (`${a}.${b}`, que es una clave de caché, no de traducción) encajaría con CUALQUIER
 *     clave con punto y dejaría el censo en cero. Pasó al escribirlo: sin ese mínimo el
 *     censo decía 0 muertas y parecía una buena noticia.
 *
 * El sondeo es CONSERVADOR a propósito, y conviene saber en qué dirección: una clave
 * cuyo último segmento sea una palabra común (`title`, `save`) cuenta como usada por el
 * mero hecho de que esa palabra aparezca en algún sitio. O sea que lo que sale es una
 * COTA INFERIOR: todo lo que lista es candidato firme, y puede haber más muertas que no
 * lista. Nunca al revés — y por eso vale como guard: no acusa en falso.
 *
 * QUÉ PONE ROJO:
 *   · una clave muerta que NO esté en PENDIENTES → cadena nueva sin uso;
 *   · una entrada de PENDIENTES que YA NO esté muerta → la lista miente y hay que
 *     recortarla (se borró la clave, o alguien volvió a usarla);
 *   · un barrido que no encuentre código o plantillas → el lector se ha roto.
 *
 * Se mide sobre `messages/es.json`, que es el catálogo de referencia; la paridad de
 * claves entre los tres idiomas la sostienen los tests de core.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Raíces de código donde puede pedirse una traducción (los 3 paquetes del workspace). */
const SRC_DIRS = [
  'apps/web/src',
  'apps/web/scripts',
  'apps/native/src',
  'apps/native/app',
  'packages/core/src',
  'scripts',
];
const EXT = ['.ts', '.tsx', '.mjs', '.js'];

/**
 * ESTE FICHERO SE EXCLUYE DEL BARRIDO, y no es un detalle: `PENDIENTES` nombra las 54
 * claves una por una, así que si el script se lee a sí mismo TODAS aparecen como
 * "usadas" y el censo da cero. Un guard que se cree su propia lista no puede ponerse
 * rojo nunca. Pasó al escribirlo: las 54 salieron como resucitadas de golpe.
 */
const EXCLUIDOS = ['scripts/check-cadenas-muertas.mjs'];

/**
 * PENDIENTES — las 54 que quedaron del censo del 2026-09-18, a la espera de que Jose
 * decida si se borran. NO es una lista de excepciones permanentes: es el punto de
 * partida. En cuanto se borren, esta lista queda VACÍA y el guard pasa a prohibir
 * cualquier cadena nueva sin uso, que es para lo que se escribió.
 *
 * Están casi todas agrupadas por pantalla, y eso dice de dónde vienen: `partido_directo`
 * son los textos de "próxima entrega" de cuando el directo era un esqueleto;
 * `home.*` es la home vieja de la web; los tres `coming_soon` son de secciones que ya
 * llegaron.
 */
const PENDIENTES = [
  'alineacion.confirm_apply',
  'alineacion.confirm_published_body',
  'alineacion.confirm_published_title',
  'alineacion.empty_hint',
  'alineacion.out_empty',
  'alineacion.resync',
  'alineacion.resync_done',
  'asistencia.range_season',
  'common.tagline',
  'dashboard.coming_soon',
  'directos.not_started_score',
  'equipo_stats.totals_row',
  'equipos.back_to_categorias',
  'home.invitations_link',
  'home.next_steps_body',
  'home.next_steps_title',
  'home.no_clubs',
  'home.signed_in_as',
  'home.your_clubs',
  'informes.coming_soon',
  'informes.editor_rework_body',
  'informes.editor_rework_title',
  'informes.team_valuation_done',
  'informes.team_valuation_pending',
  'invitations.list_section_title',
  'invite.children_heading',
  'invite.error_network',
  'invite.error_no_web_url',
  'invite.error_not_claimable',
  'invite.error_unavailable',
  'mi_equipo.nav_sesiones',
  'mi_equipo.sesiones_empty',
  'partido_directo.clock_hint',
  'partido_directo.event_registered_field',
  'partido_directo.foul_loc_committed',
  'partido_directo.foul_loc_received',
  'partido_directo.foul_pick_location',
  'partido_directo.foul_pick_player',
  'partido_directo.panel_own_title',
  'partido_directo.panel_rival_hint',
  'partido_directo.panel_rival_title',
  'partido_directo.reentry_off',
  'partido_directo.register_not_field_event',
  'partido_directo.side_label',
  'partido_directo.stub_field',
  'partido_directo.stub_player',
  'pdf.team.totals_row',
  'pizarra.from_exercise',
  'plantillas.field.half_duration_help',
  'plantillas.field.kind_help',
  'plantillas.kind_none',
  'plantillas.standard_locked_hint',
  'playbook.coming_soon',
  'sesiones.blocks.plays_empty',
];

// ── Catálogo ─────────────────────────────────────────────────────────────────
function hojas(obj, pre = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const kk = `${pre}${k}`;
    if (v && typeof v === 'object' && !Array.isArray(v)) hojas(v, `${kk}.`, out);
    else out[kk] = v;
  }
  return out;
}
const catalogo = hojas(JSON.parse(readFileSync(join(ROOT, 'messages/es.json'), 'utf8')));

// ── Código ───────────────────────────────────────────────────────────────────
function ficheros(dir, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // una raíz que no exista no es un fallo: el control positivo lo caza
  }
  for (const e of entradas) {
    if (e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) ficheros(p, acc);
    else if (
      EXT.some((x) => e.name.endsWith(x)) &&
      !EXCLUIDOS.some((x) => p.endsWith(x.split('/').join(sep)))
    ) {
      acc.push(p);
    }
  }
  return acc;
}

const FUENTES = SRC_DIRS.flatMap((d) => ficheros(join(ROOT, d)));
const BLOB = FUENTES.map((f) => readFileSync(f, 'utf8')).join('\n');
const PALABRAS = new Set(BLOB.match(/[A-Za-z0-9_]+/g) ?? []);

/** Plantillas de llamadas de traducción, ya como expresión regular. */
const PLANTILLAS = [];
for (const m of BLOB.matchAll(/\bt[A-Za-z]{0,5}\(\s*`([^`]*\$\{[^`]*)`/g)) {
  const tpl = m[1];
  const trozos = tpl.split(/\$\{[^{}]*\}/);
  const letras = trozos.join('').match(/[A-Za-z_]/g)?.length ?? 0;
  if (letras < 4) continue;
  const rx = trozos.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  try {
    PLANTILLAS.push(new RegExp(`^${rx}$`));
  } catch {
    /* una plantilla que no compila se ignora; el control positivo vigila el total */
  }
}

function seUsa(ruta) {
  const ultimo = ruta.slice(ruta.lastIndexOf('.') + 1);
  if (PALABRAS.has(ultimo)) return true;
  if (BLOB.includes(ruta)) return true;
  const cola = ruta.includes('.') ? ruta.slice(ruta.indexOf('.') + 1) : ruta;
  return PLANTILLAS.some((rx) => rx.test(ruta) || rx.test(cola) || rx.test(ultimo));
}

const muertas = Object.keys(catalogo).filter((k) => !seUsa(k)).sort();

// ── Veredicto ────────────────────────────────────────────────────────────────
const errores = [];

// Control positivo: un barrido roto no puede pasar en verde.
if (FUENTES.length < 500) {
  errores.push(
    `barrido roto: solo ${FUENTES.length} ficheros de código (esperados >500). ` +
      `Revisa SRC_DIRS.`,
  );
}
if (PLANTILLAS.length < 100) {
  errores.push(
    `barrido roto: solo ${PLANTILLAS.length} plantillas de traducción (esperadas >100). ` +
      `Sin ellas, las claves armadas con plantilla saldrían como muertas.`,
  );
}
if (Object.keys(catalogo).length < 3000) {
  errores.push(`barrido roto: solo ${Object.keys(catalogo).length} claves en el catálogo.`);
}

const pendientes = new Set(PENDIENTES);
const nuevas = muertas.filter((k) => !pendientes.has(k));
if (nuevas.length > 0) {
  errores.push(
    `${nuevas.length} cadena(s) NUEVA(S) que nadie usa. Bórralas de los tres idiomas ` +
      `(messages/es.json, en.json, va.json) o dales uso:\n` +
      nuevas.map((k) => `    ${k}  =  ${JSON.stringify(catalogo[k])}`).join('\n'),
  );
}

const vivas = PENDIENTES.filter((k) => !muertas.includes(k));
if (vivas.length > 0) {
  errores.push(
    `${vivas.length} entrada(s) de PENDIENTES ya no están muertas (se borraron, o ` +
      `alguien volvió a usarlas). Quítalas de la lista de este script: una lista que ` +
      `miente deja de vigilar.\n` + vivas.map((k) => `    ${k}`).join('\n'),
  );
}

if (errores.length > 0) {
  console.error('✗ check:cadenas-muertas\n');
  for (const e of errores) console.error(`  · ${e}\n`);
  process.exit(1);
}

console.log(
  `✓ check:cadenas-muertas — ${Object.keys(catalogo).length} claves, ` +
    `${FUENTES.length} ficheros, ${PLANTILLAS.length} plantillas; ` +
    `${muertas.length} sin uso, todas declaradas en PENDIENTES.`,
);
