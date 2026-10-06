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
 * ── NO QUEDA NINGUNA: EL CENSO ES DE CERO ──────────────────────────────────
 *
 * Eran tres. `invite` y `magic_link` se retiraron al cerrar Correo-B: los siete
 * senders de invitación crean la cuenta con `createUser` y mandan su propio
 * correo por Resend, y `signInWithOtp` no existe en el repo. Ninguna de las dos
 * la disparaba ya nadie.
 *
 * `recovery` se retiró el 06-10-2026, al cumplirse la condición que la mantenía
 * viva: el build con las puertas nuevas (#675, 21-09) está publicado en las dos
 * tiendas, y los únicos binarios anteriores eran de pruebas internas y TestFlight,
 * todos del propio Jose. MEDIDO en producción antes de tocar nada:
 * `auth.users.recovery_sent_at` llevaba QUIETA desde el 2026-09-22 —catorce días—
 * y su última actividad cae en la ventana 21-22/09, cuando aún no existía ningún
 * binario nuevo y por fuerza todo lo instalado era viejo.
 *
 * OJO con esos dos instrumentos si hay que volver a medirlo: `recovery_sent_at`
 * NO separa el camino viejo del nuevo, porque `admin.generateLink` sella la misma
 * columna; y `password_recovery_attempts` tiene retención de 25 h, así que su
 * recuento es la última jornada y NUNCA un censo histórico.
 *
 * MEDIDO al retirar las tres: una plantilla vacía NO hace que GoTrue caiga a la
 * suya por defecto. La Management API no acepta `null` (400), así que lo único
 * posible es dejar el contenido en blanco —`''`, que es como quedaron las tres— y
 * entonces el envío FALLA con HTTP 500. Para un camino retirado es la forma
 * correcta de fallar: a la vista, en vez de mandar algo raro en silencio.
 *
 * ── POR QUÉ SIGUE AQUÍ ESTE GUARD CON LA LISTA VACÍA ───────────────────────
 *
 * Porque el riesgo cambió de forma, no desapareció. Lo que hay que vigilar ahora
 * es que nadie DEVUELVA una plantilla al dashboard dejando su fichero aquí sin
 * pasar por revisión: el censo del final se pone rojo en cuanto aparece un
 * `*.html` o `*.subject.txt` que no esté en TEMPLATES. Cero es el estado
 * correcto; no se rellena la lista para tapar un rojo.
 *
 * Y la maquinaria por plantilla se queda intacta y gobernada por TEMPLATES: si
 * algún día vuelve una, se recuperan TODAS las comprobaciones poniendo su nombre
 * en la lista (y su enlace obligatorio en ENLACE_OBLIGATORIO). Lo que saben esas
 * comprobaciones está medido y costó caro; borrarlas sería tirarlo.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR = join(ROOT, 'supabase/emails');
const TEMPLATES = [];

// Qué enlace es obligatorio en cada plantilla, para cuando vuelva alguna.
// `recovery` exigía `{{ .ConfirmationURL }}`: ahí el artefacto de sesión ES el
// trámite, al revés que `invite`, donde el arreglo del BUG 4 fue `{{ .RedirectTo }}`.
const ENLACE_OBLIGATORIO = { recovery: '{{ .ConfirmationURL }}' };

const problems = [];
const fail = (msg) => problems.push('· ' + msg);

// ── Los ficheros de cada plantilla de la lista ───────────────────────────────
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
// ── CENSO DE CERO ────────────────────────────────────────────────────────────
// Lo que de verdad vigila este guard desde que no queda ninguna propia: que no
// aparezca un fichero de plantilla sin su entrada en TEMPLATES. Un fichero suelto
// aquí significa una de dos, y las dos quieren conversación: o alguien devolvió
// una plantilla al dashboard sin apuntarlo, o dejó la copia de una que ya no
// existe. Vacío es el estado correcto.
const ESPERADOS = new Set(TEMPLATES.flatMap((t) => [`${t}.html`, `${t}.subject.txt`]));
const sueltos = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith('.html') || f.endsWith('.subject.txt'))
      .filter((f) => !ESPERADOS.has(f))
      .sort()
  : [];
for (const f of sueltos) {
  fail(
    `supabase/emails/${f} no tiene entrada en TEMPLATES. Si una plantilla vuelve, ` +
      'su nombre va en la lista para que la vigilen todas las comprobaciones de ' +
      'arriba; si no vuelve, su fichero no debería seguir aquí.',
  );
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
// Antes esto miraba `bodies.recovery` por su nombre, y con la lista vacía eso
// reventaba sobre `undefined` en vez de dar un rojo legible. Ahora va por la
// lista, como todo lo demás. La regla de llevar DIRECTO a la pantalla —el arreglo
// del BUG 4— la sostiene `recoveryRedirectTo` en core, y la vigila
// `check:correo-recuperacion`.
for (const t of TEMPLATES) {
  const enlace = ENLACE_OBLIGATORIO[t];
  if (enlace && !bodies[t].includes(enlace)) {
    fail(`${t}: no usa ${enlace} (ahí el enlace ES el trámite)`);
  }
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
    `[plantillas-correo] OK — ${TEMPLATES.length} plantilla(s) propia(s) vigilada(s) ` +
      `y ${sueltos.length} fichero(s) suelto(s). Las tres (invite, magic_link y ` +
      'recovery) quedaron retiradas: contenido en blanco en el dashboard y el envío ' +
      'falla a la vista. Cero es el estado correcto.',
  );
  process.exit(0);
}
