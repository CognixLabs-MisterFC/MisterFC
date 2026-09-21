#!/usr/bin/env node
/**
 * GUARD DE CENSO — senders de invitación.
 *
 * POR QUÉ EXISTE (incidente de agosto de 2026): todo sitio que llame a
 * `auth.admin.inviteUserByEmail(...)` y CREE la cuenta DEBE enlazar después el
 * `auth.users.id` en `invitations.invited_user_id`. Sin ese enlazado el invitado
 * cae en la trampa de /invite. El barrido del arreglo #540 buscó el `.update` del
 * enlazado en vez del ENVÍO, y se le escaparon TRES senders (inviteBatch,
 * inviteStaffToTeam y performSpectatorInvite) que nunca habían enlazado. El bug
 * siguió vivo semanas y solo se ve cuando un padre no puede entrar.
 *
 * QUÉ HACE: cuenta las llamadas reales (ignora comentarios) y las compara con el
 * censo declarado abajo. Si aparece un sender nuevo, desaparece uno o cambia de
 * sitio, este script falla y obliga a pasar por el contrato de
 * `apps/web/src/lib/link-invited-user.ts` antes de mergear.
 *
 * NO comprueba que el sender enlace —eso no se puede leer de forma fiable con un
 * grep—; comprueba que NADIE añade un sender sin que un humano lo vea.
 *
 * DOS FORMAS DE SENDER (Correo-B1). Los senders están migrando de GoTrue a Resend, y
 * durante la serie conviven:
 *
 *   · LEGADO — `auth.admin.inviteUserByEmail(`: crea la cuenta Y manda el correo, con
 *     la plantilla del dashboard de Supabase. Siempre en castellano, porque esa
 *     plantilla no puede leer `profiles.locale`. Reglas: `inviteEmailMetadata(` para
 *     que el correo sepa a quién escribe, y `sendInviteToExistingUser(` para cuando
 *     el email ya tiene cuenta.
 *
 *   · RESEND — `auth.admin.createUser(`: crea la cuenta y NO manda nada; el correo lo
 *     manda el sender por su puerto, en el idioma del destinatario. Reglas: sigue
 *     necesitando `inviteEmailMetadata(` (el `user_metadata` con `invitation_id` es
 *     lo que exige `handle_new_user` desde F14D) y NO puede usar
 *     `sendInviteToExistingUser(`: a quien ya tiene cuenta se le manda el MISMO
 *     correo de invitación, no un magic link.
 *
 * Lo que este guard impide en los dos casos es lo de siempre —un sender nuevo sin que
 * nadie lo vea— y ahora además que un sender se quede A MEDIO MIGRAR: con las dos
 * llamadas a la vez mandaría dos correos, y sin ninguna no mandaría ninguno.
 *
 * ESA REGLA ES POR FICHERO, y en Correo-B4 eso obligó a MOVER un sender. En
 * `jugadores/actions.ts` vivían dos —`sendOrRenewTutorInvitation` e `inviteBatch`— y
 * migrar solo el primero dejaba el fichero con las dos llamadas: indistinguible de un
 * sender a medias. Se separó el sender (`apps/web/src/lib/invite-tutor.ts`) en vez de
 * ablandar la regla, porque la regla mide lo que importa —cuántos correos recibe el
 * invitado— y contar por sender en vez de por fichero exigiría parsear de verdad el
 * TypeScript. Si vuelve a pasar, la respuesta es la misma: sacar el sender a su
 * fichero.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN = ['apps', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.expo', '.turbo', 'dist', 'build', 'android', 'ios']);
const EXT = /\.(ts|tsx)$/;
const CALL = 'auth.admin.inviteUserByEmail(';
/** Correo-B1 — el sender migrado: crea la cuenta sin que GoTrue mande su correo. */
const CREATE = 'auth.admin.createUser(';
/**
 * A-1 — además del censo, se exige que CADA envío arme su `data` con el helper
 * compartido. La plantilla del correo ramifica por `.Data.invite_kind`: un
 * sender que escriba el objeto a mano y se deje la clave manda el texto neutro
 * y NADIE se entera —el correo sale, solo que diciendo menos de lo que debía—.
 * El tipo `InviteKind` impide equivocarse de valor; esto impide saltarse el
 * helper.
 */
const META = 'inviteEmailMetadata(';
/**
 * B-2 — y que el camino de «el correo ya tiene cuenta» NO vuelva a salir por
 * `resetPasswordForEmail`. Sale por `sendInviteToExistingUser` (plantilla de
 * magic link, con asunto de invitación). El correo de restablecer contraseña
 * sigue siendo legítimo donde toca —/forgot-password y el perfil de la app—,
 * pero en un fichero que INVITA es un asunto que miente. Un envío, un fallback.
 */
const EXISTING = 'sendInviteToExistingUser(';
const RESET = 'resetPasswordForEmail(';

/**
 * CENSO (fichero → nº de llamadas). Los 7 senders viven en 7 ficheros, y cada
 * uno manda su `invite_kind` a la plantilla (A-1):
 *   1 sendInvitation ................ invitations/actions.ts             → staff
 *   2 sendOrRenewTutorInvitation .... lib/invite-tutor.ts                → tutor
 *   5 inviteBatch ................... jugadores/actions.ts               → tutor
 *   3 inviteClubAdmin ............... lib/platform/invite-club-admin.ts  → admin
 *   4 changeClubAdmin ............... lib/platform/change-club-admin.ts  → admin
 *   7 performSpectatorInvite ........ packages/core/src/spectators/index.ts → seguidor
 *   8 performSelfInvite ............. packages/core/src/invitations/self-invite.ts → menor
 *
 * El 6 (inviteStaffToTeam, equipos/[teamId]) SE RETIRÓ en BUG 3 · A-3: invitar
 * dejó de vivir en la página de un equipo. Su hueco NO se reutiliza y la
 * numeración no se recoloca, para que los números sigan valiendo al leer los
 * comentarios viejos del repo. El siguiente sender es el 9.
 *
 * Si tocas esta lista, actualiza TAMBIÉN el censo de link-invited-user.ts.
 */
const CENSUS = {
  'apps/web/src/app/[locale]/(authenticated)/invitations/actions.ts': 1,
  'apps/web/src/app/[locale]/(authenticated)/jugadores/actions.ts': 1,
};

/**
 * CENSO DE LOS MIGRADOS (Correo-B1 y siguientes). Mismo contrato, otra forma: crean
 * la cuenta con `createUser` y mandan el correo ellos, en el idioma del destinatario.
 *
 * La serie Correo-B los irá pasando de CENSUS a este. Cuando este quede con los 7 y
 * el otro vacío, el `inviteUserByEmail` habrá desaparecido del repo y con él la
 * plantilla del dashboard: entonces esta distinción sobra y el guard se simplifica.
 *
 *   7 performSpectatorInvite ......... packages/core/src/spectators/index.ts → seguidor
 *   8 performSelfInvite .............. packages/core/src/invitations/self-invite.ts → menor
 *   3 inviteClubAdmin ................ apps/web/src/lib/platform/invite-club-admin.ts → admin
 *   4 changeClubAdmin ................ apps/web/src/lib/platform/change-club-admin.ts → admin
 *   2 sendOrRenewTutorInvitation ..... apps/web/src/lib/invite-tutor.ts → tutor
 *
 * Quedan 2 por migrar: el del cuerpo técnico (1) y el del lote (5).
 */
const CENSUS_RESEND = {
  'packages/core/src/spectators/index.ts': 1,
  'packages/core/src/invitations/self-invite.ts': 1,
  'apps/web/src/lib/platform/invite-club-admin.ts': 1,
  'apps/web/src/lib/platform/change-club-admin.ts': 1,
  'apps/web/src/lib/invite-tutor.ts': 1,
};

/** Líneas de comentario (`//`, `/*`, ` *`): el contrato y los docs citan la llamada. */
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

const found = {};
const foundResend = {};
const withMeta = {};
const withExisting = {};
const withReset = {};
for (const base of SCAN) {
  for (const file of walk(join(ROOT, base), [])) {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !isComment(l));
    const count = lines.filter((l) => l.includes(CALL)).length;
    const creates = lines.filter((l) => l.includes(CREATE)).length;
    if (count > 0 || creates > 0) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (count > 0) found[rel] = count;
      if (creates > 0) foundResend[rel] = creates;
      withMeta[rel] = lines.filter((l) => l.includes(META)).length;
      withExisting[rel] = lines.filter((l) => l.includes(EXISTING)).length;
      withReset[rel] = lines.filter((l) => l.includes(RESET)).length;
    }
  }
}

const problems = [];
for (const [file, expected] of Object.entries(CENSUS)) {
  const actual = found[file] ?? 0;
  if (actual !== expected) {
    problems.push(
      actual === 0
        ? `· DESAPARECIÓ un sender declarado: ${file} (esperadas ${expected}, encontradas 0)`
        : `· CAMBIÓ el nº de senders en ${file}: esperadas ${expected}, encontradas ${actual}`,
    );
  }
}
for (const file of Object.keys(found)) {
  if (!(file in CENSUS)) problems.push(`· SENDER NUEVO sin declarar: ${file}`);
}

// Los migrados (Correo-B1): mismo censo, otra forma.
for (const [file, expected] of Object.entries(CENSUS_RESEND)) {
  const actual = foundResend[file] ?? 0;
  if (actual !== expected) {
    problems.push(
      actual === 0
        ? `· DESAPARECIÓ un sender migrado declarado: ${file} (esperadas ${expected}, encontradas 0)`
        : `· CAMBIÓ el nº de senders migrados en ${file}: esperadas ${expected}, encontradas ${actual}`,
    );
  }
}
for (const file of Object.keys(foundResend)) {
  if (!(file in CENSUS_RESEND)) {
    problems.push(
      `· SENDER MIGRADO sin declarar: ${file}. Crea cuentas con createUser(), así que ` +
        'tiene que mandar su propio correo: decláralo en CENSUS_RESEND.',
    );
  }
  // A medio migrar: las dos llamadas a la vez mandan DOS correos (el de GoTrue y el
  // nuestro). Es el fallo más caro de esta serie y el único que no se ve leyendo el
  // diff de un solo fichero.
  if (file in found) {
    problems.push(
      `· ${file}: usa createUser() Y inviteUserByEmail(). Un sender migrado a medias ` +
        'manda dos correos al invitado: el de la plantilla de Supabase y el suyo.',
    );
  }
}

// Cada envío, su invite_kind: tantos `inviteEmailMetadata(` como envíos, sea de la
// forma que sea (el migrado lo necesita igual: `handle_new_user` exige invitation_id).
const todos = { ...found, ...foundResend };
for (const [file, senders] of Object.entries(todos)) {
  const metas = withMeta[file] ?? 0;
  if (metas !== senders) {
    problems.push(
      `· ${file}: ${senders} envío(s) pero ${metas} llamada(s) a inviteEmailMetadata(). ` +
        'Todo envío arma su `data` con el helper (invite_kind + invite_locale).',
    );
  }

  const existing = withExisting[file] ?? 0;
  if (file in CENSUS_RESEND) {
    // El migrado NO usa el magic link: a quien ya tiene cuenta le manda el MISMO
    // correo de invitación (decisión de Correo-B1).
    if (existing > 0) {
      problems.push(
        `· ${file}: es un sender migrado y usa sendInviteToExistingUser(). A quien ya ` +
          'tiene cuenta se le manda el mismo correo de invitación, no un magic link.',
      );
    }
  } else if (existing !== senders) {
    // Cada envío legado, su fallback de cuenta existente.
    problems.push(
      `· ${file}: ${senders} envío(s) pero ${existing} llamada(s) a sendInviteToExistingUser(). ` +
        'Todo envío necesita su camino para cuando el email YA tiene cuenta.',
    );
  }

  if ((withReset[file] ?? 0) > 0) {
    problems.push(
      `· ${file}: usa resetPasswordForEmail(). Un fichero que INVITA no manda ` +
        'correos de restablecer contraseña: usa sendInviteToExistingUser().',
    );
  }
}

if (problems.length > 0) {
  console.error('\n[invite-senders] El censo de senders de invitación NO cuadra:\n');
  for (const p of problems) console.error('  ' + p);
  console.error(
    '\n  Todo llamador de inviteUserByEmail que CREE la cuenta debe enlazar después\n' +
      '  invitations.invited_user_id (linkInvitedUser). Lee el contrato en\n' +
      '  apps/web/src/lib/link-invited-user.ts, engancha el enlazado y actualiza el\n' +
      '  censo AHÍ y en scripts/check-invite-senders.mjs.\n',
  );
  process.exit(1);
}

const legado = Object.values(found).reduce((a, b) => a + b, 0);
const migrados = Object.values(foundResend).reduce((a, b) => a + b, 0);
console.log(
  `[invite-senders] OK — ${legado + migrados} senders (${legado} por GoTrue, ` +
    `${migrados} por Resend), censo cuadra, todos mandan su invite_kind, ninguno ` +
    'invita por reset y ninguno está a medio migrar.',
);
