#!/usr/bin/env node
/**
 * GUARD DE CENSO — claves que el CÓDIGO pide y el catálogo NO tiene.
 *
 * ES LA DIRECCIÓN QUE FALTABA. `check-cadenas-muertas.mjs` mide catálogo → código
 * (una cadena que nadie usa). Este mide código → catálogo, y es el lado que se ve en
 * pantalla: next-intl no tipa los mensajes, así que pedir una clave que no existe no da
 * error de tipos, no da error de lint, no rompe el build y no lanza ninguna excepción.
 * Imprime la clave en crudo delante del usuario y sigue.
 *
 * LO QUE LO PROVOCÓ: un entrenador vio «directo_control.err_no_lineup» en el banner del
 * directo al intentar empezar un partido sin alineación. Al censar aparecieron 21 así,
 * en cinco pantallas de la app nativa, todas con la misma forma: un error del servidor se
 * traduce a una clave (`setErrorKey('ns.clave')`) y el banner la pinta con `t(errorKey)`.
 * Son justo las cadenas que solo se ven cuando algo va mal, o sea las que nadie mira al
 * hacer la pantalla. Más una en web: `useTranslations('calendario.errors')`, un namespace
 * que no existía (los textos estaban en `calendario.dialog.errors`).
 *
 * DOS COSAS SE MIDEN:
 *
 *  1. CLAVES LITERALES. Un literal con forma de clave (`ns.algo`) cuyo PRIMER segmento es
 *     un namespace de primer nivel del catálogo. No se mira si está dentro de un `t(...)`
 *     a propósito: las 21 que lo provocaron NO están — se devuelven desde un `switch` y se
 *     guardan en un estado, y el `t()` recibe una variable. Buscar solo en los sitios de
 *     llamada habría dado CERO y el censo habría parecido una buena noticia.
 *
 *  2. NAMESPACES. El argumento literal de `useTranslations(...)` / `getTranslations(...)`
 *     (y el `namespace:` de su forma con objeto) tiene que existir como RAMA del catálogo.
 *     Un namespace fantasma no deja sana ni una de sus claves, así que vale por muchas.
 *
 * POR QUÉ NO ACUSA EN FALSO. Un literal NO cuenta como fantasma si:
 *   · es una hoja del catálogo, o una rama;
 *   · es una RUTA PARCIAL resoluble, o sea el sufijo de alguna hoja. `t('ficha.official')`
 *     dentro de `useTranslations('informes')` pide `informes.ficha.official`, y el literal
 *     escrito es solo el final. Sin esta regla el censo acusaba 84 claves y la mayoría
 *     eran de esta familia;
 *   · acaba en una extensión de fichero conocida (`pizarra.png`, `gestion.tsx`);
 *   · está en un fichero de test: un test usa claves inventadas a propósito, y debe poder.
 *
 * Y HAY DOS CATÁLOGOS, no uno. `messages/{es,en,va}.json` lo comparten web y nativa, y
 * `apps/web/messages-web/` se monta bajo `webComercial` en `apps/web/src/i18n/request.ts`.
 * Leer solo el primero habría acusado TODA la web comercial —`t('roles.titulo')` de la
 * portada es `webComercial.portada.roles.titulo`— y un guard que acusa en falso se apaga.
 *
 * TERCERA MEDIDA, LA PARIDAD, y está aquí porque no estaba en ningún sitio. El guard
 * hermano dice que «la paridad de claves entre los tres idiomas la sostienen los tests de
 * core»: eso es verdad solo por BLOQUES. Los dos tests que la miden están acotados a uno
 * —`subscription` en core y el de consentimientos en la nativa—, y el censo de plurales
 * compara únicamente las claves con `, plural,`. O sea que una clave escrita en es y
 * olvidada en va pasaba en verde y salía en crudo en valenciano: el mismo fallo que esto
 * viene a cerrar, un idioma más allá. Aquí se comparan los juegos de claves completos de
 * los seis ficheros (es/en/va × los dos catálogos). Hoy están a la par: 4.649 y 206.
 *
 * QUÉ PONE ROJO:
 *   · un literal con forma de clave que no se resuelve y no está en EXCEPCIONES;
 *   · un namespace de `useTranslations`/`getTranslations` que no existe como rama;
 *   · una EXCEPCIÓN que ya se resuelve → la lista miente y hay que recortarla;
 *   · una clave que esté en un idioma y no en los otros dos, en cualquiera de los dos
 *     catálogos;
 *   · un barrido que no encuentre código, catálogo, literales o namespaces → el lector
 *     se ha roto, y un lector roto no puede pasar en verde.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * EXCEPCIONES — literales con forma de clave que NO son claves de traducción.
 *
 * Son cuatro y cada una dice por qué. Ojo con lo que se mete aquí: una clave de verdad
 * que se cuele en esta lista deja de verse. Si el guard señala algo que SÍ es una clave,
 * la respuesta es crearla en los tres idiomas, no apuntarla.
 *
 * Si una de estas deja de ser fantasma —porque alguien creó esa clave, o borró el
 * literal— el guard se pone ROJO y pide quitarla: una lista que miente no vigila.
 */
const EXCEPCIONES = [
  // Clave de la caché de lecturas (`fetchCached`), no del catálogo.
  { clave: 'novedades.unread', motivo: 'clave de caché de fetchCached, no de i18n' },
  // Valor del campo `action` de la auditoría de entrada a un club.
  { clave: 'platform.club_enter', motivo: 'valor de auditoría (columna action), no de i18n' },
  // `labelKey` de la navegación nativa: `navI18nKey()` (apps/native/src/nav/menu.tsx)
  // las REMAPEA al catálogo compartido (`shell.nav.*`) antes de pedirlas.
  { clave: 'nav.inicio', motivo: 'labelKey remapeado por navI18nKey a shell.nav.home' },
  {
    clave: 'nav.jugadores_consulta',
    motivo: 'labelKey remapeado por navI18nKey a shell.nav.jugadores',
  },
];

/** Raíces de código donde puede pedirse una traducción (las mismas que el hermano). */
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
 * ESTE FICHERO SE EXCLUYE: EXCEPCIONES nombra cuatro literales con forma de clave, y un
 * guard que se lee a sí mismo los ve escritos y ya no sabe si están en el código de la
 * app. Es el mismo agujero que el hermano documenta para su lista.
 */
const EXCLUIDOS = ['scripts/check-cadenas-fantasma.mjs'];

/** Extensiones que delatan un nombre de fichero, no una clave. */
const EXTENSIONES_DE_FICHERO = new Set([
  'png',
  'jpg',
  'jpeg',
  'svg',
  'webp',
  'gif',
  'ico',
  'pdf',
  'csv',
  'json',
  'sql',
  'md',
  'txt',
  'xml',
  'html',
  'css',
  'ts',
  'tsx',
  'js',
  'mjs',
  'cjs',
  'yml',
  'yaml',
  'zip',
]);

// ── Catálogos ────────────────────────────────────────────────────────────────
/** Los dos catálogos, cada uno con sus tres idiomas: seis ficheros en total. */
const CATALOGOS = [
  { nombre: 'messages', ruta: (loc) => `messages/${loc}.json` },
  { nombre: 'apps/web/messages-web', ruta: (loc) => `apps/web/messages-web/${loc}.json` },
];
const LOCALES = ['es', 'en', 'va'];

function clavesDe(obj, pre = '', acc = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const ruta = `${pre}${k}`;
    if (v && typeof v === 'object' && !Array.isArray(v)) clavesDe(v, `${ruta}.`, acc);
    else acc.add(ruta);
  }
  return acc;
}

const catalogo = {
  ...JSON.parse(readFileSync(join(ROOT, 'messages/es.json'), 'utf8')),
  // Montado igual que en apps/web/src/i18n/request.ts.
  webComercial: JSON.parse(readFileSync(join(ROOT, 'apps/web/messages-web/es.json'), 'utf8')),
};

const HOJAS = new Set();
const RAMAS = new Set();
(function recorre(obj, pre = '') {
  for (const [k, v] of Object.entries(obj)) {
    const ruta = `${pre}${k}`;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      RAMAS.add(ruta);
      recorre(v, `${ruta}.`);
    } else {
      HOJAS.add(ruta);
    }
  }
})(catalogo);

const NIVEL1 = new Set(Object.keys(catalogo));

/** Sufijos de cualquier hoja: una ruta parcial escrita bajo un namespace. */
const PARCIALES = new Set();
for (const hoja of HOJAS) {
  const seg = hoja.split('.');
  for (let i = 1; i < seg.length; i++) PARCIALES.add(seg.slice(i).join('.'));
}
for (const rama of RAMAS) {
  const seg = rama.split('.');
  for (let i = 1; i < seg.length; i++) PARCIALES.add(seg.slice(i).join('.'));
}

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

const esTest = (rel) =>
  /\.(test|spec)\.(ts|tsx|js|mjs)$/.test(rel) || rel.split(sep).includes('__tests__');

const FUENTES = SRC_DIRS.flatMap((d) => ficheros(join(ROOT, d)))
  .map((p) => p.slice(ROOT.length))
  .filter((rel) => !esTest(rel));

const FORMA_CLAVE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const LITERAL = /'([^'\n\\]{3,120})'|"([^"\n\\]{3,120})"/g;
/**
 * `useTranslations('x')`, `getTranslations('x')` y la forma con objeto,
 * `getTranslations({ locale, namespace: 'x' })`.
 *
 * El `namespace:` va ATADO a la llamada a propósito. Suelto —cualquier propiedad que se
 * llame `namespace`— cazaba el `assetlinks.json` de Android, donde `namespace:
 * 'android_app'` es de Digital Asset Links y no tiene nada que ver con i18n. El guard
 * nació acusándolo: un patrón ancho dice lo contrario de lo que pasa.
 */
const NAMESPACE = /(?:use|get)Translations\(\s*(?:'([^'\n]*)'|\{[^})]*namespace:\s*'([^'\n]*)')/g;

const fantasmas = new Map(); // clave → Set(fichero)
const nsFantasmas = new Map();
let literalesResueltos = 0;
let nsResueltos = 0;

function resuelve(s) {
  if (HOJAS.has(s) || RAMAS.has(s)) return true;
  if (PARCIALES.has(s)) return true; // ruta parcial bajo algún namespace: no se acusa
  return false;
}

for (const rel of FUENTES) {
  const txt = readFileSync(join(ROOT, rel), 'utf8');

  for (const m of txt.matchAll(LITERAL)) {
    const s = m[1] ?? m[2];
    if (!FORMA_CLAVE.test(s)) continue;
    if (!NIVEL1.has(s.split('.')[0])) continue;
    if (EXTENSIONES_DE_FICHERO.has(s.slice(s.lastIndexOf('.') + 1))) continue;
    if (resuelve(s)) {
      literalesResueltos++;
      continue;
    }
    if (!fantasmas.has(s)) fantasmas.set(s, new Set());
    fantasmas.get(s).add(rel);
  }

  for (const m of txt.matchAll(NAMESPACE)) {
    const ns = m[1] ?? m[2];
    if (ns === '' || ns == null) continue; // raíz: claves con ruta completa
    if (RAMAS.has(ns)) {
      nsResueltos++;
      continue;
    }
    if (!nsFantasmas.has(ns)) nsFantasmas.set(ns, new Set());
    nsFantasmas.get(ns).add(rel);
  }
}

// ── Veredicto ────────────────────────────────────────────────────────────────
const errores = [];

// Controles positivos: un lector roto no puede pasar en verde.
if (FUENTES.length < 500) {
  errores.push(`barrido roto: solo ${FUENTES.length} ficheros de código (esperados >500).`);
}
if (HOJAS.size < 3000) {
  errores.push(`barrido roto: solo ${HOJAS.size} hojas en los catálogos (esperadas >3000).`);
}
if (literalesResueltos < 500) {
  errores.push(
    `barrido roto: solo ${literalesResueltos} literales con forma de clave resueltos ` +
      `(esperados >500). Si el lector no los ve, tampoco ve los que faltan.`,
  );
}
if (nsResueltos < 100) {
  errores.push(
    `barrido roto: solo ${nsResueltos} namespaces resueltos (esperados >100). ` +
      `Revisa el patrón de useTranslations/getTranslations.`,
  );
}

// Paridad: los tres idiomas de cada catálogo tienen que llevar las mismas claves.
for (const cat of CATALOGOS) {
  const juegos = Object.fromEntries(
    LOCALES.map((loc) => [
      loc,
      clavesDe(JSON.parse(readFileSync(join(ROOT, cat.ruta(loc)), 'utf8'))),
    ]),
  );
  if (juegos.es.size < 100) {
    errores.push(`barrido roto: ${cat.nombre}/es.json solo tiene ${juegos.es.size} claves.`);
    continue;
  }
  for (const loc of ['en', 'va']) {
    const faltan = [...juegos.es].filter((k) => !juegos[loc].has(k)).sort();
    const sobran = [...juegos[loc]].filter((k) => !juegos.es.has(k)).sort();
    if (faltan.length > 0 || sobran.length > 0) {
      errores.push(
        `${cat.nombre}: ${loc}.json no va a la par con es.json ` +
          `(${faltan.length} sin traducir, ${sobran.length} de más). Una clave que falta ` +
          `en un idioma sale EN CRUDO a quien tenga la app en ese idioma:\n` +
          [
            ...faltan.slice(0, 20).map((k) => `    falta en ${loc}: ${k}`),
            ...sobran.slice(0, 20).map((k) => `    de más en ${loc}: ${k}`),
          ].join('\n'),
      );
    }
  }
}

const declaradas = new Set(EXCEPCIONES.map((e) => e.clave));
const nuevas = [...fantasmas.keys()].filter((k) => !declaradas.has(k)).sort();
if (nuevas.length > 0) {
  errores.push(
    `${nuevas.length} clave(s) que el código pide y el catálogo NO tiene. Créalas en los ` +
      `tres idiomas (messages/es.json, en.json, va.json) o corrige la clave:\n` +
      nuevas.map((k) => `    ${k}  @ ${[...fantasmas.get(k)].join(', ')}`).join('\n'),
  );
}

const resucitadas = EXCEPCIONES.filter((e) => !fantasmas.has(e.clave));
if (resucitadas.length > 0) {
  errores.push(
    `${resucitadas.length} EXCEPCIÓN(ES) que ya se resuelven (o cuyo literal ya no está ` +
      `en el código). Quítalas de la lista de este script: una lista que miente deja de ` +
      `vigilar.\n` +
      resucitadas.map((e) => `    ${e.clave} — ${e.motivo}`).join('\n'),
  );
}

const nsMalos = [...nsFantasmas.keys()].sort();
if (nsMalos.length > 0) {
  errores.push(
    `${nsMalos.length} namespace(s) de traducción que no existen en el catálogo. ` +
      `Ninguna de sus claves se resuelve:\n` +
      nsMalos.map((k) => `    ${k}  @ ${[...nsFantasmas.get(k)].join(', ')}`).join('\n'),
  );
}

if (errores.length > 0) {
  console.error('✗ check:cadenas-fantasma\n');
  for (const e of errores) console.error(`  · ${e}\n`);
  process.exit(1);
}

console.log(
  `✓ check:cadenas-fantasma — ${HOJAS.size} hojas en 2 catálogos, ${FUENTES.length} ` +
    `ficheros; ${literalesResueltos} literales y ${nsResueltos} namespaces resueltos, ` +
    `${EXCEPCIONES.length} excepciones declaradas; ninguna clave fantasma y los tres ` +
    `idiomas a la par.`,
);
