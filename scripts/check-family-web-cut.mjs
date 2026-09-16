#!/usr/bin/env node
/**
 * GUARD DE CENSO — el corte de la web para familias (W-B).
 *
 * POR QUÉ EXISTE: la web tiene DOS carcasas autenticadas, no una. `(authenticated)` y
 * `/spectator` son HERMANAS: la segunda no cuelga del layout de la primera, así que un
 * guard puesto solo en `(authenticated)` deja fuera el árbol entero del seguidor. Ya
 * pasó con el gate de suscripción (SU-5), donde hubo que acordarse de los dos sitios a
 * mano; y el corte de las familias tiene el mismo problema con un agravante: los
 * seguidores están DENTRO del corte (decisión 1 de Jose), o sea que ese árbol es
 * justamente el que no se puede olvidar.
 *
 * Un censo hecho a mano es verdad el día que se escribe. Este script lo mantiene: si
 * mañana alguien añade una tercera carcasa bajo `[locale]`, CI se pone roja hasta que un
 * humano diga a qué lado del corte cae.
 *
 * QUÉ COMPRUEBA, y solo esto:
 *   1. todo `layout.tsx` bajo `apps/web/src/app/[locale]` está declarado abajo;
 *   2. los que CORTAN llaman de verdad a `evaluateFamilyWebCut`;
 *   3. los que NO cortan no la llaman (si la llaman, el motivo declarado miente);
 *   4. el rebote del muro de suscripción sigue en su sitio;
 *   5. cada clave que la página de destino pide existe en LOS TRES idiomas.
 *
 * La 5 está aquí porque no puede estar en ningún otro sitio: `apps/web` no tiene runner
 * de tests y los mensajes de next-intl no están tipados, así que una clave que falte no
 * la caza ni el typecheck ni el build — se ve en producción, impresa tal cual en la
 * pantalla. Y esta pantalla concreta es la última del alta: el sitio donde una familia
 * lee el correo con el que acaba de darse de alta no puede decir «app_only.account_email».
 *
 * Lo que NO comprueba: que el corte esté puesto en el ORDEN correcto dentro del layout.
 * Eso no se lee de forma fiable con un grep y va explicado en el propio fichero — el
 * corte va DESPUÉS del re-consentimiento, o la excepción de `/re-consentimiento`
 * (decisión 2) se queda sin nadie que la alcance.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'web', 'src', 'app', '[locale]');
const SKIP = new Set(['node_modules', '.next', '.turbo']);
const CALL = 'evaluateFamilyWebCut(';

/**
 * CENSO de layouts bajo `[locale]`. `cuts: true` = tiene que aplicar el corte.
 * `cuts: false` = no debe aplicarlo, y el motivo tiene que caber en una línea.
 */
const LAYOUTS = {
  'apps/web/src/app/[locale]/layout.tsx': {
    cuts: false,
    why: 'Layout raíz: envuelve TAMBIÉN /invite, /legal y /signin, que quedan abiertos.',
  },
  'apps/web/src/app/[locale]/(authenticated)/layout.tsx': {
    cuts: true,
    why: 'Primer punto común: todo lo autenticado con club.',
  },
  'apps/web/src/app/[locale]/spectator/layout.tsx': {
    cuts: true,
    why: 'Segundo punto común: carcasa HERMANA, los seguidores entran en el corte.',
  },
  'apps/web/src/app/[locale]/legal/layout.tsx': {
    cuts: false,
    why: 'Los textos legales se quedan abiertos a propósito.',
  },
  'apps/web/src/app/[locale]/platform/layout.tsx': {
    cuts: false,
    why: 'Consola de superadmin (requireSuperadmin); un superadmin nunca es familia.',
  },
};

/** Páginas SIN layout propio que aun así tienen que rebotar. */
const PAGES = {
  'apps/web/src/app/[locale]/suscripcion/page.tsx':
    'El muro manda aquí antes de cortar; sin rebote la familia se queda en el muro.',
  'apps/web/src/app/[locale]/aplicacion/page.tsx':
    'El destino: comprueba el corte para no ser alcanzable con el interruptor apagado.',
};

/** Bloque de mensajes de la página de destino, y los idiomas que tienen que tenerlo. */
const I18N_BLOCK = 'app_only';
const LOCALES = ['es', 'en', 'va'];
const PAGE = 'apps/web/src/app/[locale]/aplicacion/page.tsx';

/** Líneas de comentario: este mismo guard y los docs citan la llamada. */
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'layout.tsx') out.push(full);
  }
  return out;
}

const rel = (f) => relative(ROOT, f).split(sep).join('/');
const calls = (file) =>
  readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .some((l) => !isComment(l) && l.includes(CALL));

const problems = [];
const encontrados = walk(APP, []).map(rel);

for (const file of encontrados) {
  if (!(file in LAYOUTS)) {
    problems.push(
      `· LAYOUT NUEVO sin declarar: ${file}\n` +
        '    Decide si esa carcasa cae dentro del corte y declárala en el censo.',
    );
  }
}

for (const [file, { cuts, why }] of Object.entries(LAYOUTS)) {
  if (!encontrados.includes(file)) {
    problems.push(`· DESAPARECIÓ un layout declarado: ${file}`);
    continue;
  }
  const aplica = calls(file);
  if (cuts && !aplica) {
    problems.push(`· NO APLICA el corte y debería: ${file}\n    (${why})`);
  }
  if (!cuts && aplica) {
    problems.push(`· APLICA el corte y el censo dice que no: ${file}\n    (${why})`);
  }
}

for (const [file, why] of Object.entries(PAGES)) {
  if (!calls(file)) {
    problems.push(`· PERDIÓ la comprobación del corte: ${file}\n    (${why})`);
  }
}

// 5 · Las claves que la página pide, en los tres idiomas. Se leen del propio fuente en
//     vez de declararlas aquí: una lista escrita a mano envejece igual que el censo que
//     este script existe para evitar.
const src = readFileSync(join(ROOT, PAGE), 'utf8');
const usadas = [...new Set([...src.matchAll(/\bt\('([a-z_]+)'\)/g)].map((m) => m[1]))];
if (usadas.length === 0) {
  problems.push(
    `· No he encontrado ni una clave t('...') en ${PAGE}.\n` +
      '    O la página cambió de forma o este guard dejó de leerla: mira cuál de las dos.',
  );
}
for (const loc of LOCALES) {
  const bloque = JSON.parse(readFileSync(join(ROOT, 'messages', `${loc}.json`), 'utf8'))[
    I18N_BLOCK
  ];
  if (!bloque) {
    problems.push(`· Falta el bloque "${I18N_BLOCK}" entero en messages/${loc}.json`);
    continue;
  }
  const faltan = usadas.filter((k) => !(k in bloque));
  if (faltan.length > 0) {
    problems.push(
      `· messages/${loc}.json — claves que la página pide y no existen: ${faltan.join(', ')}`,
    );
  }
  const sobran = Object.keys(bloque).filter((k) => !usadas.includes(k));
  if (sobran.length > 0) {
    problems.push(`· messages/${loc}.json — claves declaradas que nadie usa: ${sobran.join(', ')}`);
  }
}

if (problems.length > 0) {
  console.error('\n[family-web-cut] El censo de puntos de corte NO cuadra:\n');
  for (const p of problems) console.error('  ' + p);
  console.error(
    '\n  El corte de la web para familias se aplica en los DOS puntos comunes de la\n' +
      '  web, y `/spectator` es hermana de `(authenticated)`: no hereda su guard.\n' +
      '  Lee apps/web/src/lib/family-web-cut.ts y actualiza el censo de\n' +
      '  scripts/check-family-web-cut.mjs.\n',
  );
  process.exit(1);
}

const cortan = Object.values(LAYOUTS).filter((l) => l.cuts).length;
console.log(
  `[family-web-cut] OK — ${encontrados.length} layouts censados, ${cortan} cortan, ` +
    `${Object.keys(PAGES).length} páginas comprueban el corte, ` +
    `${usadas.length} claves de "${I18N_BLOCK}" en ${LOCALES.length} idiomas.`,
);
