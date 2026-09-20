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
 *
 * Lo que NO comprueba: que el texto sea correcto. Eso lo dice el abogado.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
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
    `y en el trace de despliegue.`,
);
