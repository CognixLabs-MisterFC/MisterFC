#!/usr/bin/env node
/**
 * GUARD — los textos legales tienen UNA sola copia, y llega al sitio donde se sirve.
 *
 * POR QUÉ EXISTE, Y POR QUÉ COMPRUEBA OTRA COSA QUE ANTES (Legal-1):
 *
 * Hasta ahora un texto legal vivía en dos ficheros idénticos —`Documentos/*.md`, los
 * .md revisados por el abogado, y `apps/web/src/content/legal/*.md`, la copia que
 * sirven las páginas públicas— y este guard comparaba byte a byte que no hubieran
 * divergido. Comparar es lo que se hace cuando no se puede evitar duplicar.
 *
 * Ya no se duplica: la copia servida se GENERA en el build desde la maestra
 * (`scripts/generar-textos-legales.mjs`) y no se versiona. No hay dos textos que
 * puedan decir cosas distintas, así que esa comparación ya no vigila nada.
 *
 * Lo que SÍ puede romperse ahora es la cadena que lleva la maestra hasta la página, y
 * cada eslabón falla de una manera silenciosa distinta:
 *
 *   1. la maestra existe y no está vacía — sin ella el build revienta (ruidoso, vale),
 *      pero un fichero vacío publica una página en blanco que nadie mira;
 *   2. todo .md de `Documentos/` está declarado en el censo, se sirva o no;
 *   3. cada slug de `LegalSlug` tiene su par declarado — un slug sin .md es un
 *      `readFileSync` que revienta al construir;
 *   4. la copia generada NO está versionada. Si alguien la vuelve a commitear, el
 *      build la pisa en silencio y el fichero del repo miente sobre lo publicado;
 *   5. el .gitignore la ignora de verdad (comprobado con git, no leyendo el fichero);
 *   6. `build` Y `dev` de apps/web invocan al generador. Si alguien quita la llamada,
 *      en local sigue funcionando —con los .md que quedaron de la última vez— y falla
 *      en Vercel, donde no queda nada;
 *   7. `Documentos/**` está en `globalDependencies` de turbo.json. Sin eso la maestra
 *      queda FUERA de las entradas del build de web: cambias el texto legal, turbo
 *      sirve el build cacheado y se publica el texto viejo sin un solo error;
 *   8. cada texto servido tiene su entrada en `outputFileTracingIncludes`
 *      (next.config). Sin ella el .md no viaja al despliegue: la página funciona en
 *      local y en producción da 500 al leerlo.
 *   9. cada texto servido está listado en TODAS las superficies que enumeran los
 *      legales (pie público, pie cruzado, sitemap y las dos tarjetas de Perfil, más el
 *  10. y las superficies NO se declaran: se DESCUBREN. Cualquier fichero que nombre
 *      dos o más slugs está enumerando los documentos y tiene que nombrarlos todos, o
 *      declararse excepción con su motivo. El 9 no basta: su lista es a mano, y
 *      `/aplicacion` fue la séptima superficie que nadie añadió (L-1).
 *      tipo `LegalDoc` de la nativa). Éste es el eslabón que se rompió de verdad:
 *      publicar el desistimiento dejó tres listas con tres documentos, y la página
 *      responde 200 aunque no se alcance desde ninguna parte.
 *
 * Lo que NO comprueba: que el texto sea correcto. Eso lo dice el abogado.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { ROOT, MAESTRA_DIR, PARES, SERVIDOS, SERVIDA_REL } from './textos-legales.mjs';

const LEGAL_CONTENT_TS = join(ROOT, 'apps/web/src/lib/legal-content.ts');
const WEB_PKG = join(ROOT, 'apps/web/package.json');
const NEXT_CONFIG = join(ROOT, 'apps/web/next.config.ts');
const TURBO_JSON = join(ROOT, 'turbo.json');
const GENERADOR = 'scripts/generar-textos-legales.mjs';

const errores = [];

/** Ficheros .md de una carpeta, o null si la carpeta no existe. */
function md(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    return null;
  }
}

const enMaestra = md(MAESTRA_DIR);

if (enMaestra === null) {
  errores.push(
    `no existe la carpeta Documentos/. Es la ÚNICA copia de los textos legales y tiene ` +
      `que viajar en git: si no, el build no puede generar las páginas públicas y este ` +
      `guard no comprueba una sola letra.`,
  );
} else {
  // 1 — cada maestra declarada existe y tiene contenido.
  let comprobados = 0;
  for (const par of SERVIDOS) {
    const ruta = join(MAESTRA_DIR, par.maestra);
    if (!existsSync(ruta)) {
      errores.push(
        `falta la copia maestra Documentos/${par.maestra} (sirve a '${par.servido}').`,
      );
      continue;
    }
    comprobados += 1;
    if (statSync(ruta).size === 0) {
      errores.push(
        `Documentos/${par.maestra} está VACÍO. El build lo copiaría igual y la página ` +
          `legal '${par.servido}' saldría en blanco, sin un solo error.`,
      );
    }
  }

  // Control positivo: sin esto, un censo vacío haría que todo lo de arriba fuera un
  // bucle que no se ejecuta y el guard pasaría en verde sin mirar nada.
  if (comprobados < 3) {
    errores.push(
      `solo se comprobaron ${comprobados} textos servidos (esperados 3 o más). El censo ` +
        `PARES se ha quedado corto y este guard ya no vigila lo que dice vigilar.`,
    );
  }

  // 2 — todo .md de la maestra está declarado, se sirva o no.
  const declaradas = new Set(PARES.map((p) => p.maestra));
  const huerfanas = enMaestra.filter((f) => !declaradas.has(f));
  if (huerfanas.length > 0) {
    errores.push(
      `documento(s) en Documentos/ sin declarar en PARES: ${huerfanas.join(', ')}. ` +
        `Declara su par, o decláralo con servido:null y el motivo, para que conste que ` +
        `no publicarlo es una decisión.`,
    );
  }
}

// 3 — cada slug de LegalSlug está declarado en el censo.
const slugsServidos = new Set(SERVIDOS.map((p) => p.servido));
if (existsSync(LEGAL_CONTENT_TS)) {
  const fuente = readFileSync(LEGAL_CONTENT_TS, 'utf8');
  const tipo = /export type LegalSlug\s*=([^;]+);/.exec(fuente)?.[1] ?? '';
  const slugs = [...tipo.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (slugs.length === 0) {
    errores.push(
      `no se pudo leer LegalSlug en apps/web/src/lib/legal-content.ts (¿cambió de ` +
        `forma?). Sin eso, un slug sin texto maestro se descubre al construir la web.`,
    );
  }
  for (const slug of slugs) {
    if (!slugsServidos.has(slug)) {
      errores.push(
        `el slug '${slug}' de LegalSlug no está en el censo PARES: el generador no ` +
          `escribiría ${SERVIDA_REL}/${slug}.md y readLegalDoc('${slug}') reventaría ` +
          `al construir la web.`,
      );
    }
  }
} else {
  errores.push(`no existe apps/web/src/lib/legal-content.ts (de donde sale LegalSlug).`);
}

/** Salida de un git que puede fallar sin que eso sea un error del repo. */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// 4 — la copia generada NO está versionada.
const versionados = git(['ls-files', `${SERVIDA_REL}/`]);
if (versionados === null) {
  console.warn(
    `  (aviso) no se pudo consultar git; no se comprueba que la copia generada esté ` +
      `fuera del repo.`,
  );
} else if (versionados.length > 0) {
  errores.push(
    `hay copias GENERADAS versionadas en git:\n        ${versionados.split('\n').join('\n        ')}\n` +
      `      El build las reescribe desde Documentos/, así que lo que diga el fichero ` +
      `del repo no es lo que se publica. Sácalas con ` +
      `\`git rm --cached ${SERVIDA_REL}/*.md\`.`,
  );
}

// 5 — y el .gitignore las ignora DE VERDAD (lo dice git, no una lectura del fichero).
const ignorado = git(['check-ignore', `${SERVIDA_REL}/privacidad.md`]);
if (ignorado === null || ignorado.length === 0) {
  errores.push(
    `${SERVIDA_REL}/ no está ignorado por git. La copia generada volvería al repo en ` +
      `el primer \`git add -A\`, y con ella la duplicación que Legal-1 quitó.`,
  );
}

// 6 — build y dev de apps/web invocan al generador.
if (existsSync(WEB_PKG)) {
  const scripts = JSON.parse(readFileSync(WEB_PKG, 'utf8')).scripts ?? {};
  for (const tarea of ['build', 'dev']) {
    const cmd = scripts[tarea] ?? '';
    if (!cmd.includes('generar-textos-legales')) {
      errores.push(
        `el script '${tarea}' de apps/web NO llama a ${GENERADOR}: "${cmd}". Sin esa ` +
          `llamada, en local sigue funcionando con los .md que quedaron de la última ` +
          `vez y en Vercel —donde no queda nada— el build revienta.`,
      );
    }
  }
} else {
  errores.push(`no existe apps/web/package.json.`);
}

// 7 — la maestra es entrada del build en turbo (si no, caché servida con texto viejo).
if (existsSync(TURBO_JSON)) {
  const turbo = JSON.parse(readFileSync(TURBO_JSON, 'utf8'));
  const globales = turbo.globalDependencies ?? [];
  const cubre = globales.some((g) => g.startsWith('Documentos/'));
  if (!cubre) {
    errores.push(
      `turbo.json no declara Documentos/ en globalDependencies (hay: ` +
        `${globales.join(', ') || 'ninguna'}). La copia maestra vive FUERA de apps/web, ` +
        `así que cambiarla no invalida la caché del build: turbo reutilizaría el build ` +
        `anterior y se publicaría el texto legal viejo sin un solo error.`,
    );
  }
} else {
  errores.push(`no existe turbo.json.`);
}

// 8 — cada texto servido viaja en el trace de despliegue.
if (existsSync(NEXT_CONFIG)) {
  const conf = readFileSync(NEXT_CONFIG, 'utf8');
  for (const par of SERVIDOS) {
    if (!conf.includes(`src/content/legal/${par.servido}.md`)) {
      errores.push(
        `'${par.servido}.md' no aparece en outputFileTracingIncludes (next.config.ts). ` +
          `El .md no viajaría al despliegue: la página va bien en local y da 500 en ` +
          `producción al leerlo.`,
      );
    }
  }
} else {
  errores.push(`no existe apps/web/next.config.ts.`);
}

// 9 — cada texto servido aparece en TODAS las superficies que enumeran los legales.
//
// El eslabón que se rompió de verdad (D-1/D-2): se publicó el formulario de
// desistimiento —maestra, censo, slug, ruta, trace, todo lo de arriba en verde— y se
// quedaron listando TRES documentos el pie público, el sitemap y el pie cruzado de las
// propias páginas legales. Ninguna de las dos listas estaba cubierta por este guard,
// así que el documento existía y no se alcanzaba desde donde se busca. Es el fallo más
// silencioso de la cadena: la página responde 200 si escribes la URL a mano.
//
// Se comprueba por el SLUG entre comillas porque las seis superficies lo escriben así,
// literal, y no por la etiqueta: las etiquetas son distintas en cada sitio (y en el
// Perfil salen del catálogo, traducidas), el slug es el mismo.
//
// LOS DOS MUROS DE PAGO NO ESTÁN AQUÍ Y ES A PROPÓSITO: llevan tres enlaces de los
// cuatro —condiciones, privacidad y desistimiento—, no la eliminación de cuenta, que
// tiene su propia tarjeta en esa misma pantalla. Los vigila
// `packages/core/src/subscription/__tests__/legal-links-census.test.ts`.
const SUPERFICIES = [
  {
    ruta: 'apps/web/src/components/legal/legal-footer.tsx',
    que: 'el pie legal de las páginas públicas SIN SESIÓN (/clubes y /signin)',
    silencio: 'quien no ha entrado todavía no tiene forma de llegar al documento',
  },
  {
    ruta: 'apps/web/src/app/[locale]/legal/layout.tsx',
    que: 'el pie que cruza unas páginas legales con otras',
    silencio: 'se llega a un documento y desde él no se ve que exista el otro',
  },
  {
    ruta: 'apps/web/src/app/sitemap.ts',
    que: 'el sitemap',
    silencio: 'la página queda fuera de lo que indexan los buscadores',
  },
  {
    ruta: 'apps/web/src/components/legal/legal-links-card.tsx',
    que: 'la tarjeta de documentos legales del Perfil web',
    silencio: 'quien ya paga deja de ver el muro y se queda sin el enlace',
  },
  {
    ruta: 'apps/native/src/screens/profile-screen.tsx',
    que: 'la tarjeta de documentos legales del Perfil nativo',
    silencio: 'lo mismo, en la pantalla que usan de verdad las familias',
  },
  {
    ruta: 'apps/native/src/legal/links.ts',
    que: 'el tipo LegalDoc de la nativa',
    silencio: 'la nativa no puede ni nombrar el documento para abrirlo',
  },
];

let superficiesLeidas = 0;
for (const sup of SUPERFICIES) {
  const ruta = join(ROOT, sup.ruta);
  if (!existsSync(ruta)) {
    errores.push(
      `no existe ${sup.ruta} (${sup.que}). Si se ha movido, actualiza SUPERFICIES: ` +
        `mientras el fichero no esté, este guard no comprueba esa superficie.`,
    );
    continue;
  }
  superficiesLeidas += 1;
  const fuente = readFileSync(ruta, 'utf8');
  for (const par of SERVIDOS) {
    if (!fuente.includes(`'${par.servido}'`) && !fuente.includes(`"${par.servido}"`)) {
      errores.push(
        `'${par.servido}' no aparece en ${sup.ruta} — ${sup.que}. La página se sirve ` +
          `igual y responde 200, pero ${sup.silencio}.`,
      );
    }
  }
}

// Controles positivos del bloque. Hacen falta LOS DOS, y el primero se me escapó: con
// `SUPERFICIES` vacía, `superficiesLeidas < SUPERFICIES.length` es `0 < 0` y el guard
// pasaba en VERDE sin mirar una sola superficie. Un censo vacío no es un censo que
// cumple: es un bucle que no se ejecuta.
const SUPERFICIES_MINIMAS = 6;
if (SUPERFICIES.length < SUPERFICIES_MINIMAS) {
  errores.push(
    `SUPERFICIES declara ${SUPERFICIES.length} superficies y son al menos ` +
      `${SUPERFICIES_MINIMAS}: pie público, pie cruzado, sitemap, las dos tarjetas de ` +
      `Perfil y el tipo LegalDoc. Si de verdad desaparece una, baja este número a ` +
      `mano y di por qué — que quitar la vigilancia sea una decisión y no un descuido.`,
  );
}
if (superficiesLeidas < SUPERFICIES.length) {
  errores.push(
    `solo se leyeron ${superficiesLeidas} de ${SUPERFICIES.length} superficies que ` +
      `enumeran los legales. Este bloque ya no vigila lo que dice vigilar.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10 — LAS SUPERFICIES SE DESCUBREN. El eslabón 9 no basta, y lo demostró L-1.
//
// El 9 comprueba una lista ESCRITA A MANO de seis ficheros. `/aplicacion` era el
// séptimo: llevaba dos enlaces de los cuatro, y cuando #717 añadió el desistimiento no
// se enteró nadie —ni este guard, ni el censo de `legal-links-census.test.ts`, que
// también tiene su lista a mano, de dos—. Y era la peor pantalla donde pasara: con el
// corte de la web encendido, `/aplicacion` es LA web para una familia, y es la última
// pantalla del alta. Justo quien acaba de darse de alta, que es quien está en plazo de
// desistir, era quien no encontraba el formulario.
//
// Así que aquí se invierte: en vez de preguntar «¿están los cuatro en los seis ficheros
// que recuerdo?», se pregunta «¿QUÉ ficheros hablan de los legales, y les falta alguno?».
// Un fichero que nombre DOS o más slugs está enumerando los documentos, y entonces tiene
// que nombrarlos todos — o declararse excepción, con su motivo escrito.
//
// ── TRES DECISIONES QUE HACEN QUE ESTO NO DÉ LA LATA ─────────────────────────
//
//  1. SE QUITAN LOS COMENTARIOS ANTES DE MEDIR. Sin esto, el propio comentario que
//     explica el arreglo de L-1 —que menciona «privacidad» y «desistimiento»— convertía
//     `/aplicacion` en una superficie incompleta otra vez. Un guard que castiga a quien
//     deja el motivo escrito enseña a no escribirlo.
//
//  2. FUERA LOS TESTS. Un test que censa los muros nombra tres slugs y no ofrece nada a
//     nadie: no es una superficie, es la red. Confundirlos obligaría a que cada test
//     mencionara los cuatro para poder hablar de uno.
//
//  3. EL UMBRAL ES DOS, no uno. La página de un documento nombra su propio slug y no
//     enumera nada; con umbral uno, `legal/desistimiento/page.tsx` sería una superficie
//     a la que le faltan tres.
//
// ── LAS EXCEPCIONES FIJAN SU JUEGO EXACTO ───────────────────────────────────
// No dicen «esta está perdonada»: dicen QUÉ lleva. Si un día una gana o pierde un
// documento, la excepción deja de cuadrar y salta — hay que volver a pensarla, que es lo
// que se quiere. Es la misma idea que el `motivo` obligatorio de `subscription_grants`:
// una excepción sin razón escrita es la que nadie se atreve a quitar.
const EXCEPCIONES = [
  {
    ruta: 'apps/web/src/app/[locale]/suscripcion/page.tsx',
    lleva: ['privacidad', 'terminos', 'desistimiento'],
    motivo:
      'muro de pago: Apple (Guideline 3.1.2) exige términos y privacidad, y el ' +
      'desistimiento lo pide la normativa de consumo —debe leerse ANTES de pagar—. ' +
      'La eliminación de cuenta no pertenece a ese trío: no se borra la cuenta desde el muro.',
  },
  {
    ruta: 'apps/native/src/subscription/paywall.tsx',
    lleva: ['privacidad', 'terminos', 'desistimiento'],
    motivo: 'el mismo muro, en la nativa, y por las mismas tres razones.',
  },
  {
    ruta: 'apps/native/app/invite/[token].tsx',
    lleva: ['privacidad', 'terminos'],
    motivo:
      'no es un directorio legal: son las dos CASILLAS de aceptación del alta, una por ' +
      'documento que se acepta, y se corresponden con los dos consent_type de la cuenta. ' +
      'Nadie ACEPTA un formulario de desistimiento ni una política de eliminación.',
  },
];

/**
 * El código sin comentarios. Ni perfecto ni pretende serlo: quita bloques `/* *\/`,
 * comentarios JSX y los de `//`, respetando `https://` (van precedidos de dos puntos).
 * Si algún día se le escapa uno, el modo de fallo es una superficie de más que hay que
 * mirar, no una de menos que pasa callada.
 */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const EXT_CODIGO = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const DIRS_FUERA = new Set(['node_modules', '.next', 'dist', 'build', 'content']);

function ficherosDeCodigo(dirRel, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(join(ROOT, dirRel), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entradas) {
    const rel = `${dirRel}/${e.name}`;
    if (e.isDirectory()) {
      if (!DIRS_FUERA.has(e.name)) ficherosDeCodigo(rel, acc);
    } else if (EXT_CODIGO.has(extname(e.name))) {
      acc.push(rel);
    }
  }
  return acc;
}

const esTest = (ruta) => ruta.includes('__tests__/') || /\.test\.[jt]sx?$/.test(ruta);
const nombra = (src, slug) =>
  new RegExp(`(?<![\\w-])${slug.replace(/[-]/g, '\\-')}(?![\\w-])`).test(src);

const descubiertas = [];
for (const ruta of [...ficherosDeCodigo('apps'), ...ficherosDeCodigo('packages')]) {
  if (esTest(ruta)) continue;
  let src;
  try {
    src = sinComentarios(readFileSync(join(ROOT, ruta), 'utf8'));
  } catch {
    continue;
  }
  const lleva = SERVIDOS.map((p) => p.servido).filter((slug) => nombra(src, slug));
  if (lleva.length >= 2) descubiertas.push({ ruta, lleva });
}

// CONTROL POSITIVO, y es el que se me escapó una vez: si el barrido no encuentra nada,
// el bucle de abajo no se ejecuta y el bloque pasa en VERDE sin mirar un solo fichero.
// El suelo son las seis del eslabón 9 más las tres excepciones.
const DESCUBIERTAS_MINIMAS = SUPERFICIES_MINIMAS + EXCEPCIONES.length;
if (descubiertas.length < DESCUBIERTAS_MINIMAS) {
  errores.push(
    `el barrido del eslabón 10 encontró ${descubiertas.length} ficheros que enumeran ` +
      `legales y son al menos ${DESCUBIERTAS_MINIMAS}. O se ha roto el recorrido, o ha ` +
      `cambiado la forma de nombrar los slugs: este bloque ya no vigila nada.`,
  );
}

// SEGUNDO CONTROL: las seis del eslabón 9 tienen que SALIR del barrido. Si una no sale,
// el descubrimiento no ve lo que el 9 ya sabía, y entonces tampoco vería a su séptima.
for (const sup of SUPERFICIES) {
  if (!descubiertas.some((d) => d.ruta === sup.ruta)) {
    errores.push(
      `el barrido del eslabón 10 NO encontró ${sup.ruta}, que el eslabón 9 sí vigila. ` +
        `El descubrimiento se le escapa una superficie conocida: no hay motivo para ` +
        `creer que encontraría una nueva.`,
    );
  }
}

const porRuta = new Map(EXCEPCIONES.map((e) => [e.ruta, e]));
for (const { ruta, lleva } of descubiertas) {
  const faltan = SERVIDOS.map((p) => p.servido).filter((s) => !lleva.includes(s));
  const exc = porRuta.get(ruta);

  if (faltan.length === 0) {
    // Una excepción que ya lleva los cuatro sobra, y sobrando estorba: la siguiente
    // persona la lee como un permiso vigente.
    if (exc) {
      errores.push(
        `${ruta} está en EXCEPCIONES pero ya nombra los ${SERVIDOS.length} documentos. ` +
          `Quita la excepción: un permiso que no hace falta se acaba usando de coartada.`,
      );
    }
    continue;
  }

  if (!exc) {
    errores.push(
      `${ruta} enumera legales (${lleva.join(', ')}) y le falta(n) ${faltan.join(', ')}. ` +
        `La página se sirve igual y responde 200, pero desde ahí no se llega a ese ` +
        `documento. Si de verdad no debe llevarlo, declárala en EXCEPCIONES con su ` +
        `motivo — que la ausencia sea una decisión escrita y no un descuido.`,
    );
    continue;
  }

  // La excepción fija su juego EXACTO: sobra y falta se miran las dos.
  const sobra = lleva.filter((s) => !exc.lleva.includes(s));
  const noEstan = exc.lleva.filter((s) => !lleva.includes(s));
  if (sobra.length > 0 || noEstan.length > 0) {
    errores.push(
      `la excepción de ${ruta} dice llevar [${exc.lleva.join(', ')}] y lleva ` +
        `[${lleva.join(', ')}]` +
        (sobra.length ? ` (de más: ${sobra.join(', ')})` : '') +
        (noEstan.length ? ` (de menos: ${noEstan.join(', ')})` : '') +
        `. Ha cambiado lo que hace, así que su motivo hay que volver a pensarlo: ` +
        `«${exc.motivo}»`,
    );
  }
}

// Una excepción cuyo fichero ya no enumera legales —o ya no existe— es ruido que la
// próxima persona leerá como vigente.
for (const exc of EXCEPCIONES) {
  if (!descubiertas.some((d) => d.ruta === exc.ruta)) {
    errores.push(
      `la excepción de ${exc.ruta} ya no corresponde a ningún fichero que enumere ` +
        `legales (¿se movió, se borró, o dejó de enlazarlos?). Quítala.`,
    );
  }
}

if (errores.length > 0) {
  console.error('✗ check:textos-legales\n');
  for (const e of errores) console.error(`  · ${e}\n`);
  process.exit(1);
}

const noServidos = PARES.length - SERVIDOS.length;
console.log(
  `✓ check:textos-legales — ${SERVIDOS.length} textos con copia ÚNICA en Documentos/ ` +
    `y generada al construir, ${noServidos} documento(s) declarado(s) como no ` +
    `servido(s); generador enchufado a build y dev, maestra en las entradas de turbo ` +
    `y en el trace de despliegue; los ${SERVIDOS.length} listados en las ` +
    `${SUPERFICIES.length} superficies declaradas y en las ${descubiertas.length} ` +
    `descubiertas (${EXCEPCIONES.length} con juego incompleto y motivo escrito).`,
);
