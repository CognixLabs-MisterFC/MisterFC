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
/** El cliente de la app, de donde sale la lista de códigos con texto propio. */
const CLIENTE = 'apps/native/src/auth/password-recovery.ts';
const NS_PANTALLA = 'auth.forgot_password';

/**
 * CENSO de la forma vieja (fichero → nº de llamadas). Mandaba por Supabase, en
 * castellano para todo el mundo.
 *
 * ESTÁ VACÍO, Y NO ES QUE SE HAYA OLVIDADO NADIE: las tres puertas están migradas y
 * `resetPasswordForEmail(` no existe en ningún fichero del repo. Vacío es el estado
 * CORRECTO, y el guard sigue vivo: cualquier aparición nueva cae en «PUERTA NUEVA sin
 * declarar» de abajo. Lo que NO hay que hacer es volver a llenarlo para «arreglar» un
 * rojo — el rojo significa que alguien ha reabierto el camino a Supabase.
 */
const CENSO_RESET = {};
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

// ── 2 · Los textos de la PANTALLA, que son otros ─────────────────────────────
//
// Los de arriba son los del CORREO. Estos son los que ve quien lo pide y algo falla.
// Se leen de la lista del propio cliente (`CON_TEXTO`) y no de una copia a mano aquí:
// una segunda lista se queda vieja el día que alguien añada un código y no la toque.
//
// Qué pasa si falta uno: `recoveryMessageKey` devuelve la clave, el catálogo no la
// encuentra y la pantalla pinta «error_network» al usuario. No revienta nada, que es
// justo por lo que nadie se entera.
{
  const ruta = join(ROOT, CLIENTE);
  if (!existsSync(ruta)) {
    problems.push(`· no existe ${CLIENTE} (el cliente de la app).`);
  } else {
    const fuente = readFileSync(ruta, 'utf8');
    const lista = /const CON_TEXTO[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(fuente)?.[1] ?? '';
    const codigos = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    // Control positivo: si el lector se rompe, esto NO puede pasar en verde sin mirar
    // nada — que es justo como se pierde un guard.
    if (codigos.length < 3) {
      problems.push(
        `· no se pudo leer CON_TEXTO en ${CLIENTE} (${codigos.length} códigos). ` +
          '¿Cambió de forma? Sin eso, aquí no se comprueba un solo texto de pantalla.',
      );
    } else {
      // `generic` es el suelo de `recoveryMessageKey`: si falta, no hay red debajo.
      for (const codigo of [...codigos, 'generic']) {
        for (const idioma of IDIOMAS) {
          const ruta = join(ROOT, `messages/${idioma}.json`);
          if (!existsSync(ruta)) continue;
          const catalogo = JSON.parse(readFileSync(ruta, 'utf8'));
          const bloque = NS_PANTALLA.split('.').reduce((o, k) => (o == null ? o : o[k]), catalogo);
          const v = bloque?.[`error_${codigo}`];
          if (typeof v !== 'string' || v.trim().length === 0) {
            problems.push(
              `· messages/${idioma}.json: falta '${NS_PANTALLA}.error_${codigo}'. La ` +
                'pantalla pintaría el NOMBRE DE LA CLAVE al usuario.',
            );
          }
        }
      }
    }
  }
}

// ── 3 · El destino del enlace (BUG 4) ────────────────────────────────────────
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

// ── 4 · El censo de la forma vieja ───────────────────────────────────────────
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
      `· ${file} usa ${RESET}. Ese camino volvió a Supabase: manda la plantilla del ` +
        'dashboard, siempre en castellano, y se salta el contador de envíos. Las tres ' +
        `puertas piden el correo a ${SENDER} — la app, por ` +
        '/api/auth/password-recovery.',
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
  `[correo-recuperacion] OK — textos del correo y de la pantalla completos en es, en ` +
    `y va; el enlace sigue yendo ` +
    `directo a /{locale}/reset-password; ${pendientes} puerta(s) por migrar ` +
    '(las tres salen ya por Resend).',
);
