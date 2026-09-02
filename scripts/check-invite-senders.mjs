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
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN = ['apps', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.expo', '.turbo', 'dist', 'build', 'android', 'ios']);
const EXT = /\.(ts|tsx)$/;
const CALL = 'auth.admin.inviteUserByEmail(';

/**
 * CENSO (fichero → nº de llamadas). Los 7 senders viven en 6 ficheros:
 *   1 sendInvitation ................ invitations/actions.ts
 *   2 sendOrRenewTutorInvitation ..... jugadores/actions.ts
 *   5 inviteBatch .................... jugadores/actions.ts  (2 en el mismo fichero)
 *   6 inviteStaffToTeam .............. equipos/[teamId]/actions.ts
 *   3 inviteClubAdmin ................ lib/platform/invite-club-admin.ts
 *   4 changeClubAdmin ................ lib/platform/change-club-admin.ts
 *   7 performSpectatorInvite ......... packages/core/src/spectators/index.ts
 * Si tocas esta lista, actualiza TAMBIÉN el censo de link-invited-user.ts.
 */
const CENSUS = {
  'apps/web/src/app/[locale]/(authenticated)/invitations/actions.ts': 1,
  'apps/web/src/app/[locale]/(authenticated)/jugadores/actions.ts': 2,
  'apps/web/src/app/[locale]/(authenticated)/equipos/[teamId]/actions.ts': 1,
  'apps/web/src/lib/platform/invite-club-admin.ts': 1,
  'apps/web/src/lib/platform/change-club-admin.ts': 1,
  'packages/core/src/spectators/index.ts': 1,
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
for (const base of SCAN) {
  for (const file of walk(join(ROOT, base), [])) {
    const count = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !isComment(l) && l.includes(CALL)).length;
    if (count > 0) found[relative(ROOT, file).split(sep).join('/')] = count;
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
console.log(`[invite-senders] OK — ${total} senders en ${Object.keys(found).length} ficheros, censo cuadra.`);
