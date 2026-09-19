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
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR = join(ROOT, 'supabase/emails');
const KINDS_FILE = join(ROOT, 'packages/core/src/invitations/invite-email-metadata.ts');

const TEMPLATES = ['invite', 'recovery', 'magic_link'];

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

// ── La invitación tiene una rama por destinatario ────────────────────────────
// La lista MANDA desde el código (`INVITE_KINDS`): si aparece un sexto tipo, su
// rama tiene que existir ANTES de usarlo. Sin ella el correo sale con el texto
// neutro y nadie se entera.
const kindsSrc = readFileSync(KINDS_FILE, 'utf8');
const bloque = kindsSrc.match(/INVITE_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
if (!bloque) {
  fail(`no se pudo leer INVITE_KINDS de ${KINDS_FILE}`);
} else {
  const kinds = [...bloque[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  if (kinds.length === 0) fail('INVITE_KINDS se leyó vacío (¿cambió el formato?)');
  // El CUERPO sí lleva una rama por tipo: ahí el texto cambia de verdad.
  for (const kind of kinds) {
    if (!bodies.invite.includes(`"${kind}"`)) {
      fail(`invite (cuerpo): falta la rama de "${kind}"`);
    }
  }
  // El ASUNTO no se exige tipo a tipo, y es deliberado: `staff` comparte asunto
  // con la rama neutra («Te han invitado a MisterFC»), y obligar a escribir esa
  // rama dos veces con el mismo texto sería ruido, no vigilancia. Lo que sí se
  // exige es que el asunto SIGA RAMIFICANDO: si alguien lo aplana a una frase
  // fija, los cuatro asuntos propios se pierden en silencio.
  const kindsEnAsunto = kinds.filter((k) => subjects.invite.includes(`"${k}"`));
  if (kindsEnAsunto.length === 0) {
    fail('invite (asunto): no ramifica por invite_kind (¿se aplanó a un texto fijo?)');
  }
  // Y la rama neutra, que es la que recoge a quien llegue sin `invite_kind`
  // (una invitación mandada desde el propio dashboard, por ejemplo).
  if (!/\{\{\s*else\s*\}\}/.test(bodies.invite)) {
    fail('invite (cuerpo): no hay rama neutra `{{ else }}`');
  }
  if (!/\{\{\s*else\s*\}\}/.test(subjects.invite)) {
    fail('invite (asunto): no hay rama neutra `{{ else }}`');
  }
}

// ── El enlace de cada plantilla ──────────────────────────────────────────────
// invite y magic_link llevan a /{locale}/invite/{token} DIRECTO: manda la
// caducidad de la invitación y no la del OTP, y la página funciona solo con el
// token. `{{ .ConfirmationURL }}` ahí es el BUG 4 otra vez.
// recovery sí necesita ConfirmationURL: ahí el artefacto ES el trámite.
for (const t of ['invite', 'magic_link']) {
  if (!bodies[t].includes('{{ .RedirectTo }}')) {
    fail(`${t}: no usa {{ .RedirectTo }}`);
  }
  if (bodies[t].includes('.ConfirmationURL')) {
    fail(
      `${t}: usa {{ .ConfirmationURL }}. Ese fue el BUG 4 — debe ser ` +
        '{{ .RedirectTo }}, que lleva directo a la invitación.',
    );
  }
}
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
    `[plantillas-correo] OK — ${TEMPLATES.length} plantillas con su asunto, ` +
      'ramas completas y enlaces correctos.',
  );
  process.exit(0);
}
