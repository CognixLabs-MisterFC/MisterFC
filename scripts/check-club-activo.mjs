#!/usr/bin/env node
/**
 * GUARD — elegir club por ROL en vez de por el CLUB ACTIVO.
 *
 * POR QUÉ EXISTE: la pantalla de invitaciones mostraba, entrando en UDFonteta,
 * las invitaciones de CD Ejemplo. El código era
 *
 *     const authorized = clubs.find((c) => ROLES_ALLOWED_TO_INVITE.includes(c.role));
 *
 * «el primer club de mis membresías que me deja invitar». Y `fetchUserClubs`
 * ordena esa lista por nombre con `localeCompare`, así que con dos clubes ganaba
 * SIEMPRE el alfabéticamente primero: `'CD Ejemplo'.localeCompare('UDFonteta')`
 * es -1. La cookie `active_club_id` no entraba en la decisión.
 *
 * NO era un fallo de superadmin: no hay ninguna rama de superadmin en ese código.
 * Lo sufre cualquiera con membresías en dos clubes y rol de dirección en uno.
 * Superadmin es solo quien da la casualidad de tener dos.
 *
 * Y NO hay red debajo: `user_role_in_club` devuelve 'admin_club' a un superadmin
 * en CUALQUIER club (F14B-2, 20260921000000_f14b_2_superadmin_chokepoint), así
 * que para él la RLS no acota. El club que pasa el código es la única puerta.
 *
 * ── QUÉ COMPRUEBA ──────────────────────────────────────────────────────────
 *
 * Busca en apps/web/src y packages/core/src las formas de «coger un club de una
 * lista»: `clubs.find(`, `memberships.find(`, `clubs[0]`, `memberships[0]`.
 * De cada ocurrencia mira la expresión (paréntesis balanceados desde el match):
 *
 *   · si COMPARA UN ID (`.id === …`) es segura por construcción: no está
 *     eligiendo un club, está buscando uno que ya conoce. Pasa.
 *   · si no, exige una entrada en CENSO justificando por qué.
 *
 * Y al revés: una entrada de CENSO cuyo fichero ya no tiene la expresión
 * TAMBIÉN es rojo, para que el censo no se quede rancio. Ya sirvió una vez:
 * `staff-invite.ts` entró en el censo como «lo arregla el PR siguiente», y al
 * arreglarlo el guard se puso rojo hasta que se quitó la entrada.
 *
 * SE QUITAN LOS COMENTARIOS ANTES DE BUSCAR. Si no, este guard se dispararía
 * con la explicación de arriba, y con los comentarios que las dos páginas
 * arregladas dejaron contando cuál era el fallo.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const RAICES = ['apps/web/src', 'packages/core/src'];

/**
 * Ocurrencias legítimas, fichero → por qué. Cualquier fichero que no esté aquí
 * y tenga una de estas expresiones sin comparar id es un rojo.
 */
const CENSO = {
  'packages/core/src/auth/active-club.ts':
    'ES el resolver del club activo: su `clubs[0]` es el fallback documentado ' +
    'para cookie ausente o apuntando a un club que no es tuyo.',
  'apps/web/src/components/shell/app-shell.tsx':
    'Elige el club PROPIO frente al acceso de plataforma (`!c.isPlatformAccess`), ' +
    'no por rol: no es una elección de club activo, es distinguir membresía real ' +
    'de modo superadmin.',
};

const problemas = [];
const fallar = (m) => problemas.push('· ' + m);

/** Quita comentarios de bloque y de línea. Sin esto el guard se dispara con su
 *  propia documentación — y con la de las páginas que explican el fallo. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function ficheros(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e === '__tests__') continue;
      ficheros(p, acc);
      continue;
    }
    if (!/\.tsx?$/.test(e)) continue;
    if (/\.test\.tsx?$/.test(e)) continue;
    acc.push(p);
  }
  return acc;
}

/** Desde el match, la expresión completa: paréntesis balanceados, o hasta fin de
 *  línea si no abre ninguno (el caso de `clubs[0]`). */
function expresion(texto, i) {
  const ini = texto.lastIndexOf('\n', i) + 1;
  let prof = 0;
  let j = i;
  for (; j < texto.length; j++) {
    const c = texto[j];
    if (c === '(') prof++;
    else if (c === ')') {
      prof--;
      if (prof <= 0) break;
    } else if (c === '\n' && prof === 0) break;
  }
  return texto.slice(ini, Math.min(j + 1, texto.length));
}

const FORMA = /\b(?:clubs|memberships)\s*(?:\.find\(|\[0\])/g;
const COMPARA_ID = /\.id\s*[!=]==/;

let total = 0;
const conOcurrencia = new Set();

for (const raiz of RAICES) {
  const dir = join(ROOT, raiz);
  if (!existsSync(dir)) {
    fallar(`no existe ${raiz} (¿se movió? el guard dejaría de medir)`);
    continue;
  }
  for (const file of ficheros(dir)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    const src = sinComentarios(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(FORMA)) {
      total++;
      const expr = expresion(src, m.index);
      if (COMPARA_ID.test(expr)) continue;
      conOcurrencia.add(rel);
      if (!(rel in CENSO)) {
        fallar(
          `${rel}: coge un club de la lista sin comparar id y sin entrada en ` +
            `CENSO →  ${expr.trim().slice(0, 120)}\n    Si es una elección de ` +
            'club para consultar datos, usa el CLUB ACTIVO (`loadShellContext`, ' +
            'que además fabrica el club sintético del superadmin en club ajeno). ' +
            'Si es legítimo, añádelo a CENSO con el porqué.',
        );
      }
    }
  }
}

// Ancla positiva: si el escaneo no encuentra NADA, está roto (rutas movidas,
// extensión cambiada, comentarios comiéndose el fichero) y un verde no valdría.
if (total === 0) {
  fallar(
    'cero ocurrencias en todo el árbol: el escaneo está roto, no limpio. ' +
      'Al menos active-club.ts tiene `clubs[0]` por diseño.',
  );
}

// Censo rancio: una entrada cuyo fichero ya no tiene la expresión.
for (const rel of Object.keys(CENSO)) {
  if (!conOcurrencia.has(rel)) {
    fallar(
      `${rel} está en CENSO pero ya no coge ningún club así. Quita la entrada: ` +
        'un censo que sobrevive a su motivo deja pasar la próxima recaída.',
    );
  }
}

if (problemas.length > 0) {
  console.error('\n[club-activo] Elección de club sin pasar por el club activo:\n');
  for (const p of problemas) console.error('  ' + p);
  console.error(
    '\n  El club que se consulta sale de la cookie `active_club_id`, no del\n' +
      '  primer club de tus membresías. Ver invitations/page.tsx para el patrón\n' +
      '  correcto y el porqué.\n',
  );
  process.exit(1);
}

console.log(
  `[club-activo] OK — ${total} expresión(es) de elección de club, ` +
    `${Object.keys(CENSO).length} censada(s) con motivo y el resto comparando id.`,
);
process.exit(0);
