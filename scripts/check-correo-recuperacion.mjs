#!/usr/bin/env node
/**
 * GUARD — el correo de restablecer contraseña.
 *
 * POR QUÉ EXISTE. Es el octavo y último correo de la serie Correo-B, y el único que
 * se pide SIN SESIÓN. Eso le da dos formas de romperse en silencio que no tienen los
 * siete de invitación, y ninguna de las dos la ve el compilador:
 *
 *   1. UN TEXTO QUE FALTE EN UN IDIOMA. `passwordRecoveryEmail` compone con el
 *      catálogo de next-intl: una clave ausente no es un error de compilación, es una
 *      excepción EN EL ENVÍO, en producción, y solo para quien tenga ese idioma. Quien
 *      lo sufra no recibe nada y no puede entrar en su cuenta. Se descubre por soporte.
 *
 *   2. EL DESTINO DEL ENLACE. Fue el BUG 4 (#638): el correo llevaba a
 *      `/auth/callback?next=…`, el fragmento no viaja al servidor, y el usuario
 *      entraba en la app SIN que nadie le pidiera una contraseña nueva — la vieja
 *      seguía valiendo. El arreglo fue apuntar DIRECTO a `/{locale}/reset-password`.
 *      Aquí se vigila que siga apuntando ahí y que nadie se fabrique el destino a
 *      mano por su cuenta.
 *
 * Y un censo de `resetPasswordForEmail(`, que es la forma vieja: manda el correo por
 * Supabase, con la plantilla única del dashboard, siempre en castellano. Se va
 * retirando puerta a puerta y el censo dice cuántas quedan, para que la última no se
 * quede ahí para siempre sin que nadie se acuerde.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN = ['apps', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.expo', '.turbo', 'dist', 'build', 'android', 'ios']);
const EXT = /\.(ts|tsx)$/;

const IDIOMAS = ['es', 'en', 'va'];
const NS = 'emails.password_recovery';
const CLAVES = ['subject', 'heading', 'body', 'cta', 'fallback', 'ignore', 'signature'];

/** El sender, y la función de core que decide el destino del enlace. */
const SENDER = 'apps/web/src/lib/email/password-recovery.ts';
const ENLACE = 'packages/core/src/auth/recovery-link.ts';

/**
 * CENSO de la forma vieja (fichero → nº de llamadas). Manda por Supabase, en
 * castellano para todo el mundo. Quedan las DOS puertas de la app; la web ya salió.
 * Cuando se migren, este censo baja a cero y hay que dejarlo VACÍO aquí.
 */
const CENSO_RESET = {
  'apps/native/src/screens/forgot-password-modal.tsx': 1,
  'apps/native/src/screens/profile-screen.tsx': 1,
};
const RESET = 'resetPasswordForEmail(';

/** Líneas de comentario: los docs citan las llamadas. */
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(entry)) out.push(full);
  }
  return out;
}

const problems = [];

// ── 1 · Los textos, en los tres idiomas ──────────────────────────────────────
for (const idioma of IDIOMAS) {
  const ruta = join(ROOT, `messages/${idioma}.json`);
  if (!existsSync(ruta)) {
    problems.push(`· falta messages/${idioma}.json.`);
    continue;
  }
  const catalogo = JSON.parse(readFileSync(ruta, 'utf8'));
  const bloque = NS.split('.').reduce((o, k) => (o == null ? o : o[k]), catalogo);
  if (bloque == null || typeof bloque !== 'object') {
    problems.push(
      `· messages/${idioma}.json no tiene '${NS}'. Quien pida su contraseña en ` +
        `${idioma} no recibirá NADA y no podrá entrar en su cuenta.`,
    );
    continue;
  }
  for (const clave of CLAVES) {
    const v = bloque[clave];
    if (typeof v !== 'string' || v.trim().length === 0) {
      problems.push(`· messages/${idioma}.json: falta '${NS}.${clave}'.`);
    }
  }
}

// ── 2 · El destino del enlace (BUG 4) ────────────────────────────────────────
if (!existsSync(join(ROOT, ENLACE))) {
  problems.push(`· no existe ${ENLACE}, que es quien decide a dónde lleva el correo.`);
} else {
  const fuente = readFileSync(join(ROOT, ENLACE), 'utf8');
  if (!fuente.includes('/${locale}/reset-password`')) {
    problems.push(
      `· ${ENLACE} ya no construye \`/{locale}/reset-password\`. Ese destino DIRECTO ` +
        'fue el arreglo del BUG 4: con el rodeo por /auth/callback el fragmento se ' +
        'perdía y el usuario entraba sin que nadie le pidiera contraseña nueva.',
    );
  }
}

if (!existsSync(join(ROOT, SENDER))) {
  problems.push(`· no existe ${SENDER} (el envío del correo de recuperación).`);
} else {
  const fuente = readFileSync(join(ROOT, SENDER), 'utf8');
  if (!fuente.includes('recoveryRedirectTo(')) {
    problems.push(
      `· ${SENDER} no usa recoveryRedirectTo(). El destino del enlace se decide en UN ` +
        'sitio: fabricarlo a mano aquí es cómo volvería el BUG 4 sin que nadie lo vea.',
    );
  }
}

// ── 3 · El censo de la forma vieja ───────────────────────────────────────────
const found = {};
for (const base of SCAN) {
  for (const file of walk(join(ROOT, base), [])) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const n = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !isComment(l) && l.includes(RESET)).length;
    if (n > 0) found[rel] = n;
  }
}

for (const [file, expected] of Object.entries(CENSO_RESET)) {
  const actual = found[file] ?? 0;
  if (actual !== expected) {
    problems.push(
      actual === 0
        ? `· ${file} ya no usa ${RESET}: ¿se ha migrado? Quita su línea del censo.`
        : `· CAMBIÓ el nº de llamadas a ${RESET} en ${file}: ${expected} → ${actual}.`,
    );
  }
}
for (const file of Object.keys(found)) {
  if (!(file in CENSO_RESET)) {
    problems.push(
      `· PUERTA NUEVA sin declarar: ${file} usa ${RESET}. Ese camino manda por ` +
        'Supabase, siempre en castellano. Lo que hay que usar es ' +
        `${SENDER}.`,
    );
  }
}
if (Object.keys(found).some((f) => f.startsWith('apps/web/'))) {
  problems.push(
    `· apps/web vuelve a usar ${RESET}. La web ya manda por Resend: si un camino ` +
      'vuelve a Supabase, ese usuario recibe el correo en castellano sin que nadie lo note.',
  );
}

if (problems.length > 0) {
  console.error('\n[correo-recuperacion] El correo de restablecer contraseña NO cuadra:\n');
  for (const p of problems) console.error('  ' + p);
  console.error(
    '\n  El envío vive en apps/web/src/lib/email/password-recovery.ts y los textos en\n' +
      "  messages/{es,en,va}.json bajo 'emails.password_recovery'.\n",
  );
  process.exit(1);
}

const pendientes = Object.values(CENSO_RESET).reduce((a, b) => a + b, 0);
console.log(
  `[correo-recuperacion] OK — textos completos en es, en y va; el enlace sigue yendo ` +
    `directo a /{locale}/reset-password; ${pendientes} puerta(s) por migrar de las de la app.`,
);
