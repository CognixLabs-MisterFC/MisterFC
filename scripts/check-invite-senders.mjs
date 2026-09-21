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
 * CÓMO MANDA UN SENDER, desde que la serie Correo-B terminó (B6): crea la cuenta con
 * `auth.admin.createUser(` —que NO manda correo— y manda él el suyo por Resend, en el
 * idioma del destinatario. Reglas: `inviteEmailMetadata(` en cada envío (el
 * `user_metadata` con `invitation_id` es lo que exige `handle_new_user` desde F14D), y
 * ni rastro de las dos formas retiradas.
 *
 * LO QUE SE RETIRÓ, y por qué el guard lo vigila por su nombre en TODO el repo y no
 * solo en los senders censados:
 *
 *   · `auth.admin.inviteUserByEmail(` — creaba la cuenta y mandaba el correo con la
 *     plantilla única del dashboard de Supabase. Esa plantilla no puede leer
 *     `profiles.locale`: salía siempre en castellano. Que vuelva a aparecer en
 *     cualquier fichero significa que alguien ha reabierto ese camino.
 *   · `sendInviteToExistingUser(` — el magic link para quien ya tenía cuenta. Desde
 *     Correo-B1 a esa persona se le manda el MISMO correo de invitación que a los
 *     demás, así que la función se borró de core al cerrar la serie.
 *   · `resetPasswordForEmail(` — invitar con un asunto de "restablecer contraseña".
 *     Donde toca sigue siendo legítimo —quedan las dos puertas de la app, censadas en
 *     `check-correo-recuperacion.mjs`—, pero no en un fichero que invita. La web ya no
 *     lo usa: su correo de recuperación también sale por Resend.
 *
 * Y ADEMÁS: que el correo que manda cada sender TENGA TEXTO en los tres idiomas. Ver
 * la nota de esa sección, más abajo.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN = ['apps', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.expo', '.turbo', 'dist', 'build', 'android', 'ios']);
const EXT = /\.(ts|tsx)$/;
/** La forma ÚNICA de crear la cuenta de un invitado: no manda correo. */
const CREATE = 'auth.admin.createUser(';
/**
 * A-1 — además del censo, se exige que CADA envío arme su `data` con el helper
 * compartido. El `user_metadata` lleva el `invitation_id` que exige `handle_new_user`
 * y el `invite_kind` que elige el texto: un sender que escriba el objeto a mano y se
 * deje una clave manda un correo que dice menos de lo que debía, y eso no se nota.
 * El tipo `InviteKind` impide equivocarse de valor; esto impide saltarse el helper.
 */
const META = 'inviteEmailMetadata(';
/** Las tres formas retiradas. Ninguna puede aparecer en ningún fichero del repo. */
const RETIRADAS = [
  ['auth.admin.inviteUserByEmail(', 'crea la cuenta Y manda el correo con la plantilla del dashboard, que sale siempre en castellano'],
  ['sendInviteToExistingUser(', 'el magic link para quien ya tiene cuenta; se borro de core al cerrar la serie Correo-B'],
];
/** Y esta, solo prohibida DENTRO de un sender (fuera sigue siendo legitima). */
const RESET = 'resetPasswordForEmail(';

/**
 * CENSO (fichero → nº de llamadas). Los 7 senders viven en 7 ficheros, uno cada uno, y
 * cada uno manda su `invite_kind` (A-1). Hasta B6 hubo DOS censos, uno por forma de
 * envío, mientras la serie Correo-B iba migrando; ahora que todos salen igual sobra la
 * distinción y vuelve a ser una sola lista:
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
  'apps/web/src/lib/invite-tutor.ts': 1,
  'apps/web/src/lib/platform/invite-club-admin.ts': 1,
  'apps/web/src/lib/platform/change-club-admin.ts': 1,
  'packages/core/src/spectators/index.ts': 1,
  'packages/core/src/invitations/self-invite.ts': 1,
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
const withMeta = {};
const withReset = {};
/** Apariciones de las formas retiradas, en CUALQUIER fichero (fichero → literal). */
const retiradas = [];

for (const base of SCAN) {
  for (const file of walk(join(ROOT, base), [])) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !isComment(l));

    for (const [literal, motivo] of RETIRADAS) {
      const n = lines.filter((l) => l.includes(literal)).length;
      if (n > 0) retiradas.push({ rel, literal, motivo, n });
    }

    const creates = lines.filter((l) => l.includes(CREATE)).length;
    if (creates > 0) {
      found[rel] = creates;
      withMeta[rel] = lines.filter((l) => l.includes(META)).length;
      withReset[rel] = lines.filter((l) => l.includes(RESET)).length;
    }
  }
}

const problems = [];

// Las formas retiradas: ninguna, en ningún sitio.
for (const { rel, literal, motivo, n } of retiradas) {
  problems.push(
    `· ${rel}: usa \`${literal}\` (${n}). Es una forma RETIRADA — ${motivo}. ` +
      'Los correos de invitación los manda la app por Resend; mira ' +
      'apps/web/src/lib/email/invite-ports.ts y cualquiera de los 7 senders.',
  );
}

// El censo: ni uno de más, ni uno de menos, ni cambiado de sitio.
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

// Control positivo: un censo que se quedara corto haría que todo lo de arriba
// fuera un bucle que no se ejecuta, y el guard pasaría sin mirar nada.
const declarados = Object.values(CENSUS).reduce((a, b) => a + b, 0);
if (declarados < 7) {
  problems.push(
    `· el censo declara ${declarados} senders (esperados 7 o más). Se ha quedado corto ` +
      'y este guard ya no vigila lo que dice vigilar.',
  );
}

// Cada envío, su invite_kind; y ningún fichero que invite mandando un reset.
for (const [file, senders] of Object.entries(found)) {
  const metas = withMeta[file] ?? 0;
  if (metas !== senders) {
    problems.push(
      `· ${file}: ${senders} envío(s) pero ${metas} llamada(s) a inviteEmailMetadata(). ` +
        'Todo envío arma su `data` con el helper (invitation_id + invite_kind + invite_locale).',
    );
  }
  if ((withReset[file] ?? 0) > 0) {
    problems.push(
      `· ${file}: usa resetPasswordForEmail(). Un fichero que INVITA no manda ` +
        'correos de restablecer contraseña: manda el de invitación, como los demás.',
    );
  }
}

/**
 * ── Y que el correo que manda cada sender migrado TENGA TEXTO ────────────────
 *
 * El censo de arriba vigila que nadie mande sin que se vea. Esto vigila lo de
 * después: que lo que se manda no salga vacío.
 *
 * `invitationEmail` compone con el catálogo de next-intl, así que una clave que falte
 * en un idioma no es un error de compilación: es una excepción EN EL ENVÍO, en
 * producción, y solo para quien tenga ese idioma. El sender la trata como un fallo de
 * correo cualquiera —devuelve error y registra— pero la invitación ya está creada y
 * el invitado no recibe nada. Se descubre cuando alguien no puede entrar.
 *
 * Lo que se exige, leyendo las dos listas del CÓDIGO (no de una copia a mano):
 *   · cada `kind` de NAMESPACE_BY_KIND tiene su bloque en los TRES catálogos;
 *   · con las cuatro piezas comunes (cta, fallback, ignore, signature);
 *   · y el asunto, el título y el cuerpo — en `staff`, uno por cada rol de
 *     ROL_CON_TEXTO, porque ahí el texto depende del papel con el que se invita.
 */
const PLANTILLA = join(ROOT, 'apps/web/src/lib/email/invitation-email.ts');
const IDIOMAS = ['es', 'en', 'va'];
const COMUNES = ['cta', 'fallback', 'ignore', 'signature'];
const PROPIAS = ['subject', 'heading', 'body'];

if (!existsSync(PLANTILLA)) {
  problems.push(`· no existe apps/web/src/lib/email/invitation-email.ts (de donde salen los textos).`);
} else {
  const fuente = readFileSync(PLANTILLA, 'utf8');

  const mapa = /const NAMESPACE_BY_KIND[^=]*=\s*{([^}]*)}/.exec(fuente)?.[1] ?? '';
  const kinds = [...mapa.matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((m) => ({ kind: m[1], ns: m[2] }));

  const rolesRaw = /const ROL_CON_TEXTO[^=]*=\s*{([^}]*)}/.exec(fuente)?.[1] ?? '';
  const roles = [...rolesRaw.matchAll(/(\w+)\s*:\s*true/g)].map((m) => m[1]);

  // Control positivo: si los dos lectores se rompen, esto NO puede pasar en verde
  // sin mirar nada —que es justo como se pierde un guard—.
  if (kinds.length < 3 || roles.length < 3) {
    problems.push(
      `· no se pudieron leer NAMESPACE_BY_KIND (${kinds.length}) ni ROL_CON_TEXTO ` +
        `(${roles.length}) en invitation-email.ts. ¿Cambiaron de forma? Sin eso, este ` +
        `guard no comprueba un solo texto.`,
    );
  } else {
    for (const idioma of IDIOMAS) {
      const ruta = join(ROOT, `messages/${idioma}.json`);
      if (!existsSync(ruta)) {
        problems.push(`· falta messages/${idioma}.json.`);
        continue;
      }
      const catalogo = JSON.parse(readFileSync(ruta, 'utf8'));
      for (const { kind, ns } of kinds) {
        const bloque = ns.split('.').reduce((o, k) => (o == null ? o : o[k]), catalogo);
        if (bloque == null || typeof bloque !== 'object') {
          problems.push(
            `· messages/${idioma}.json no tiene '${ns}', el correo del tipo '${kind}'. ` +
              `Quien lo reciba en ${idioma} no recibirá nada.`,
          );
          continue;
        }
        const falta = (clave, obj = bloque) =>
          typeof obj?.[clave] !== 'string' || obj[clave].trim().length === 0;

        for (const clave of COMUNES) {
          if (falta(clave)) problems.push(`· messages/${idioma}.json: falta '${ns}.${clave}'.`);
        }
        if (kind === 'staff') {
          for (const rol of roles) {
            for (const clave of PROPIAS) {
              if (falta(clave, bloque.roles?.[rol])) {
                problems.push(
                  `· messages/${idioma}.json: falta '${ns}.roles.${rol}.${clave}'. Invitar ` +
                    `con el rol '${rol}' reventaría al componer el correo.`,
                );
              }
            }
          }
        } else {
          for (const clave of PROPIAS) {
            if (falta(clave)) problems.push(`· messages/${idioma}.json: falta '${ns}.${clave}'.`);
          }
        }
      }
    }
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

const total = Object.values(found).reduce((a, b) => a + b, 0);
console.log(
  `[invite-senders] OK — ${total} senders, censo cuadra, todos mandan su invite_kind, ` +
    'ninguna de las formas retiradas (inviteUserByEmail, el magic link de cuenta ' +
    'existente, el reset) sigue viva, y los correos tienen texto completo en es, en y va.',
);
