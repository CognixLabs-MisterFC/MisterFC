#!/usr/bin/env node
/**
 * GUARD — plantillas de correo (copia del repo).
 *
 * POR QUÉ EXISTE: las plantillas de GoTrue viven en el dashboard de Supabase.
 * No pasan por revisión, no dejan diff y nadie se entera si cambian. Ya mordió
 * una vez: el BUG 4 se arregló cambiando `{{ .ConfirmationURL }}` por
 * `{{ .RedirectTo }}` en la plantilla de invitación, y ese arreglo vive en una
 * caja de texto de una web — a un repegado de distancia de perderse.
 *
 * `supabase/emails/` es la COPIA REVISADA: lo que debería estar publicado. Este
 * guard corre en CI y NO habla con Supabase (el workflow no tiene secretos):
 * comprueba la copia contra sí misma y contra el código. Para comparar con lo
 * que hay VIVO está `pnpm plantillas:diff`, que se lanza a mano.
 *
 * Lo que NO hace, a propósito: desplegar. Las plantillas se pegan a mano.
 *
 * ── QUEDA UNA, Y ES TEMPORAL ───────────────────────────────────────────────
 *
 * Eran tres. `invite` y `magic_link` se retiraron al cerrar Correo-B: los siete
 * senders de invitación crean la cuenta con `createUser` y mandan su propio
 * correo por Resend, y `signInWithOtp` no existe en el repo. Ninguna de las dos
 * la disparaba ya nadie.
 *
 * `recovery` sigue aquí por una razón de CALENDARIO, no de diseño: las versiones
 * de la app YA INSTALADAS llaman a `resetPasswordForEmail`, que la usa. Se retira
 * cuando el build con las puertas nuevas esté fuera y las viejas hayan drenado.
 *
 * MEDIDO al retirar las otras dos, y conviene saberlo antes de retirar esta: una
 * plantilla vacía NO hace que GoTrue caiga a la suya por defecto. El envío FALLA
 * (HTTP 500, «Error sending invite email») y no se crea la cuenta. Para `invite`
 * y `magic_link` eso es lo correcto —un camino retirado que falla a la vista es
 * mejor que uno que manda algo raro en silencio—, pero para `recovery` querría
 * decir que quien pida su contraseña desde una app vieja no recibe nada.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR = join(ROOT, 'supabase/emails');
const TEMPLATES = ['recovery'];

const problems = [];
const fail = (msg) => problems.push('· ' + msg);

// ── Los seis ficheros ────────────────────────────────────────────────────────
const bodies = {};
const subjects = {};
for (const t of TEMPLATES) {
  for (const [ext, bag] of [['html', bodies], ['subject.txt', subjects]]) {
    const file = join(DIR, `${t}.${ext}`);
    if (!existsSync(file)) {
      fail(`falta supabase/emails/${t}.${ext}`);
      continue;
    }
    const content = readFileSync(file, 'utf8');
    if (content.trim().length === 0) fail(`supabase/emails/${t}.${ext} está vacío`);
    bag[t] = content;
  }
}
if (problems.length > 0) report();

// ── Asuntos: una sola línea ──────────────────────────────────────────────────
// Un asunto con un salto de línea en medio no es un asunto partido: es una
// cabecera rota. El dashboard acepta pegarlo igual.
for (const t of TEMPLATES) {
  if (subjects[t].trimEnd().includes('\n')) {
    fail(`el asunto de ${t} ocupa más de una línea`);
  }
}

// ── Asuntos: 255 caracteres, SINTAXIS INCLUIDA ───────────────────────────────
// Límite del dashboard, no nuestro: al pegar un asunto más largo contesta
// «Failed to validate template: subject: Too big: expected string to have <=255
// characters» y NO GUARDA NADA — ni el asunto ni el cuerpo. Se descubrió pegando
// a mano: el primer asunto ramificado medía 411 y el rechazo pasó por «aún no lo
// he pegado» hasta que `plantillas:diff` dijo que el vivo seguía siendo el viejo.
//
// Cuenta la plantilla entera: `{{ if eq $k "tutor" }}` gasta 22 de esos 255. Por
// eso el de invitación conserva solo dos ramas (ver el README).
//
// Se miden las DOS formas de contar —caracteres y bytes UTF-8— porque no sabemos
// cuál usa el validador del dashboard, y un acento vale 1 o 2 según cuál sea.
// Pasar las dos es la única manera de no volver a descubrirlo pegando.
const MAX_ASUNTO = 255;
for (const t of TEMPLATES) {
  const asunto = subjects[t].trimEnd();
  const chars = [...asunto].length;
  const bytes = Buffer.byteLength(asunto, 'utf8');
  if (chars > MAX_ASUNTO || bytes > MAX_ASUNTO) {
    fail(
      `el asunto de ${t} mide ${chars} caracteres (${bytes} bytes) y el máximo ` +
        `del dashboard es ${MAX_ASUNTO}, sintaxis de plantilla incluida. ` +
        'Si te pasas, Supabase rechaza el guardado entero.',
    );
  }
}

// ── Acciones de Go template balanceadas ──────────────────────────────────────
// `{{ if }}`, `{{ with }}` y `{{ range }}` cierran con `{{ end }}`. Un `end` de
// menos no rompe el render: rompe el ENVÍO, y el correo no sale.
for (const t of TEMPLATES) {
  for (const [nombre, texto] of [['cuerpo', bodies[t]], ['asunto', subjects[t]]]) {
    const abre = (texto.match(/\{\{-?\s*(if|with|range)\b/g) ?? []).length;
    const cierra = (texto.match(/\{\{-?\s*end\s*-?\}\}/g) ?? []).length;
    if (abre !== cierra) {
      fail(`${t} (${nombre}): ${abre} apertura(s) if/with/range y ${cierra} end`);
    }
  }
}

// ── `.Data` solo dentro de `with .Data` ──────────────────────────────────────
// `auth.users.raw_user_meta_data` es NULLABLE y sin default. Con `.Data` nulo,
// `eq .Data.loquesea "x"` no cae en la rama neutra: revienta el render y el
// correo NO SE MANDA. El `with` lo evita, y por eso se exige.
for (const t of TEMPLATES) {
  for (const [nombre, texto] of [['cuerpo', bodies[t]], ['asunto', subjects[t]]]) {
    const usos = (texto.match(/\.Data\b/g) ?? []).length;
    const guardados = (texto.match(/with\s+\.Data\b/g) ?? []).length;
    if (usos !== guardados) {
      fail(
        `${t} (${nombre}): ${usos} uso(s) de .Data y ${guardados} dentro de ` +
          '`with .Data`. Sin el `with`, un metadata nulo tumba el envío.',
      );
    }
  }
}

// ── El enlace ────────────────────────────────────────────────────────────────
// `recovery` SÍ necesita `{{ .ConfirmationURL }}`, al revés que las dos retiradas:
// ahí el artefacto de sesión ES el trámite. La regla de llevar DIRECTO a la
// pantalla —el arreglo del BUG 4— la sostiene hoy `recoveryRedirectTo` en core, y
// la vigila `check:correo-recuperacion`.
if (!bodies.recovery.includes('{{ .ConfirmationURL }}')) {
  fail('recovery: no usa {{ .ConfirmationURL }} (ahí sí es el enlace del trámite)');
}

report();

function report() {
  if (problems.length > 0) {
    console.error('\n[plantillas-correo] La copia del repo NO cuadra:\n');
    for (const p of problems) console.error('  ' + p);
    console.error(
      '\n  Las plantillas vivas están en el dashboard de Supabase; esto es la\n' +
        '  copia revisada (supabase/emails/). Para ver si el dashboard se ha\n' +
        '  movido: pnpm plantillas:diff (lee, no escribe, y pide token).\n',
    );
    process.exit(1);
  }
  console.log(
    `[plantillas-correo] OK — ${TEMPLATES.length} plantilla(s) con su asunto y su ` +
      'enlace correcto. invite y magic_link quedaron retiradas al cerrar Correo-B; ' +
      'recovery espera a que drenen las apps instaladas.',
  );
  process.exit(0);
}
