#!/usr/bin/env node
/**
 * GUARD DE CENSO — las dos copias de cada texto legal dicen lo MISMO.
 *
 * POR QUÉ EXISTE: un texto legal vive en dos sitios y tiene que ser el mismo en los
 * dos.
 *
 *   · `Documentos/*.md` — los .md revisados por el abogado. La copia MAESTRA: es la
 *     que se manda a revisar y la que se archiva.
 *   · `apps/web/src/content/legal/*.md` — la copia que se SIRVE. La leen las páginas
 *     públicas (`/legal/privacidad`, `/legal/terminos`, `/legal/eliminacion-cuenta`)
 *     con `readLegalDoc`, desde el sistema de ficheros, en build-time.
 *
 * La segunda existe porque la primera no se puede servir: `readLegalDoc` lee de
 * `process.cwd()` de apps/web y los .md se fuerzan en el trace de despliegue con
 * `outputFileTracingIncludes`. Duplicar es la solución; que las copias se separen sin
 * que nadie se entere, no.
 *
 * Y ahí estaba el agujero: `Documentos/` llevaba en el .gitignore desde el #455 —una
 * línea colada en un commit de google-services.json, bajo el encabezado de Sentry, sin
 * comentario y sin motivo—, así que la copia maestra NO viajaba en git. La garantía de
 * que coincidían era que alguien se acordara de copiar el fichero a mano. Un texto
 * legal desincronizado no da error: la web publica una versión y el archivo del
 * abogado dice otra, que es exactamente lo que no puede pasar con un documento que
 * regula lo que el club hace con datos de menores.
 *
 * QUÉ COMPRUEBA:
 *   1. cada par declarado existe y es idéntico BYTE A BYTE (sin normalizar nada: un
 *      espacio distinto dentro de un texto legal es un cambio real);
 *   2. todo .md de `content/legal/` está declarado — un texto servido nuevo sin
 *      original sería una copia sin maestra;
 *   3. todo .md de `Documentos/` está declarado, aunque no se sirva (el contrato de
 *      encargo no se sirve: se declara con `servido: null` y así consta);
 *   4. cada slug de `LegalSlug` tiene su fichero — un slug sin .md es un `readFileSync`
 *      que revienta en build-time, no un error de tipos.
 *
 * Lo que NO comprueba: que el texto sea correcto. Eso lo dice el abogado.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MAESTRA_DIR = join(ROOT, 'Documentos');
const SERVIDA_DIR = join(ROOT, 'apps/web/src/content/legal');
const LEGAL_CONTENT_TS = join(ROOT, 'apps/web/src/lib/legal-content.ts');

/**
 * El censo. `servido: null` = ese documento NO se publica en la web, y se declara
 * para que conste que la ausencia es a propósito y no un olvido.
 */
const PARES = [
  { maestra: 'misterfc-politica-privacidad.md', servido: 'privacidad.md' },
  { maestra: 'misterfc-terminos-condiciones.md', servido: 'terminos.md' },
  { maestra: 'misterfc-eliminacion-cuenta.md', servido: 'eliminacion-cuenta.md' },
  {
    maestra: 'misterfc-contrato-encargo-tratamiento.md',
    servido: null,
    // Anexo de protección de datos que se firma con cada club (art. 28 RGPD). No es
    // una página pública: es una plantilla en blanco que se rellena por club.
    motivo: 'contrato que se firma con cada club, no es una página pública',
  },
];

const errores = [];

function md(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return null; // carpeta ausente: se reporta abajo con su nombre
  }
}

const enMaestra = md(MAESTRA_DIR);
const enServida = md(SERVIDA_DIR);

if (enMaestra === null) {
  errores.push(
    `no existe la carpeta Documentos/. Es la copia MAESTRA de los textos legales y ` +
      `tiene que viajar en git: si no, este guard no compara nada en CI y pasa en ` +
      `verde sin haber comprobado una sola letra.`,
  );
}
if (enServida === null) {
  errores.push(`no existe apps/web/src/content/legal/ (de donde lee readLegalDoc).`);
}

if (enMaestra && enServida) {
  // 1 — los pares coinciden byte a byte.
  let comparados = 0;
  for (const par of PARES) {
    if (par.servido === null) continue;
    const a = join(MAESTRA_DIR, par.maestra);
    const b = join(SERVIDA_DIR, par.servido);
    if (!existsSync(a)) {
      errores.push(`falta la copia maestra Documentos/${par.maestra}`);
      continue;
    }
    if (!existsSync(b)) {
      errores.push(`falta la copia servida content/legal/${par.servido}`);
      continue;
    }
    const ta = readFileSync(a);
    const tb = readFileSync(b);
    comparados += 1;
    if (!ta.equals(tb)) {
      // Se da la primera línea que difiere: es lo que hace falta para arreglarlo.
      const la = readFileSync(a, 'utf8').split('\n');
      const lb = readFileSync(b, 'utf8').split('\n');
      let n = 0;
      while (n < Math.max(la.length, lb.length) && la[n] === lb[n]) n += 1;
      errores.push(
        `DIVERGEN Documentos/${par.maestra} y content/legal/${par.servido} ` +
          `(${ta.length} vs ${tb.length} bytes). Primera diferencia en la línea ` +
          `${n + 1}:\n        maestra:  ${JSON.stringify(la[n] ?? '(fin de fichero)')}\n` +
          `        servida:  ${JSON.stringify(lb[n] ?? '(fin de fichero)')}\n` +
          `      La maestra manda: copia Documentos/${par.maestra} sobre ` +
          `apps/web/src/content/legal/${par.servido}.`,
      );
    }
  }

  // Control positivo: si el censo se quedara sin pares, todo lo de arriba sería un
  // bucle vacío y el guard pasaría en verde sin comparar nada.
  if (comparados < 3) {
    errores.push(
      `solo se compararon ${comparados} pares (esperados 3 o más). El censo PARES se ` +
        `ha quedado corto y este guard ya no vigila lo que dice vigilar.`,
    );
  }

  // 2 — todo texto SERVIDO está declarado.
  const declaradosServidos = new Set(
    PARES.map((p) => p.servido).filter((x) => x !== null),
  );
  const servidosHuerfanos = enServida.filter((f) => !declaradosServidos.has(f));
  if (servidosHuerfanos.length > 0) {
    errores.push(
      `texto(s) servido(s) sin declarar en PARES: ${servidosHuerfanos.join(', ')}. ` +
        `Se publican sin copia maestra que los respalde: declara su par (o di por qué ` +
        `no tiene).`,
    );
  }

  // 3 — todo .md de la maestra está declarado, se sirva o no.
  const declaradosMaestra = new Set(PARES.map((p) => p.maestra));
  const maestraHuerfanos = enMaestra.filter((f) => !declaradosMaestra.has(f));
  if (maestraHuerfanos.length > 0) {
    errores.push(
      `documento(s) en Documentos/ sin declarar: ${maestraHuerfanos.join(', ')}. ` +
        `Declara su par, o declárala con servido:null y el motivo, para que conste ` +
        `que no publicarla es una decisión.`,
    );
  }
}

// 4 — cada slug de LegalSlug tiene su fichero servido.
if (existsSync(LEGAL_CONTENT_TS) && enServida) {
  const fuente = readFileSync(LEGAL_CONTENT_TS, 'utf8');
  const tipo = /export type LegalSlug\s*=([^;]+);/.exec(fuente)?.[1] ?? '';
  const slugs = [...tipo.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (slugs.length === 0) {
    errores.push(
      `no se pudo leer LegalSlug en apps/web/src/lib/legal-content.ts (¿cambió de ` +
        `forma?). Sin eso, un slug sin fichero se descubre en build-time.`,
    );
  }
  for (const slug of slugs) {
    if (!enServida.includes(`${slug}.md`)) {
      errores.push(
        `el slug '${slug}' de LegalSlug no tiene content/legal/${slug}.md: ` +
          `readLegalDoc('${slug}') reventaría al construir la web.`,
      );
    }
  }
}

if (errores.length > 0) {
  console.error('✗ check:textos-legales\n');
  for (const e of errores) console.error(`  · ${e}\n`);
  process.exit(1);
}

const servidos = PARES.filter((p) => p.servido !== null).length;
console.log(
  `✓ check:textos-legales — ${servidos} textos servidos idénticos a su copia ` +
    `maestra, ${PARES.length - servidos} documento(s) declarado(s) como no servido(s).`,
);
