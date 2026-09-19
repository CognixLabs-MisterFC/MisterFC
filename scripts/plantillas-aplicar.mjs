#!/usr/bin/env node
/**
 * Publica UNA plantilla de `supabase/emails/` en Supabase, por la Management API.
 *
 * POR QUÉ EXISTE, y no es comodidad: **el formulario del dashboard no puede
 * guardar la plantilla de invitación.** Medido el 2026-09-19 — con el asunto
 * ramificado contesta «Failed to update email templates: failed to update Auth
 * config» y no guarda; con uno de más de 255, «Too big». La misma cadena, por
 * esta API, entra sin una queja (se probaron ocho variantes: variable simple,
 * if/else, declaración, `with`, asignación, y el asunto completo de 238).
 *
 * O sea que la copia del repo NO tiene otra forma de llegar a producción. Sin
 * esto, `supabase/emails/` sería un museo.
 *
 * NO es despliegue automático y no corre en CI: hay que llamarlo a mano, con el
 * nombre de la plantilla, y confirmar con `--si`. Sin `--si` solo enseña lo que
 * cambiaría.
 *
 *   pnpm plantillas:aplicar invite          # enseña el cambio, no toca nada
 *   pnpm plantillas:aplicar invite --si     # lo aplica y lo vuelve a leer
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR = join(ROOT, 'supabase/emails');
const TEMPLATES = ['invite', 'recovery', 'magic_link'];

const nombre = process.argv[2];
const confirmado = process.argv.includes('--si');

if (!TEMPLATES.includes(nombre)) {
  console.error(
    `[plantillas:aplicar] Uso: pnpm plantillas:aplicar <${TEMPLATES.join('|')}> [--si]`,
  );
  process.exit(2);
}

function env(name) {
  if (process.env[name]) return process.env[name];
  const file = join(ROOT, 'apps/web/.env.local');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const token = env('SUPABASE_ACCESS_TOKEN');
const ref = env('SUPABASE_PROJECT_REF');
if (!token || !ref) {
  console.error('[plantillas:aplicar] Faltan SUPABASE_ACCESS_TOKEN o SUPABASE_PROJECT_REF.');
  process.exit(2);
}
const URL_CFG = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function leerConfig() {
  const r = await fetch(URL_CFG, { headers: H });
  if (!r.ok) {
    console.error(`[plantillas:aplicar] La API respondió ${r.status} al leer.`);
    process.exit(2);
  }
  return r.json();
}

// El dashboard guarda sin salto final; el fichero del repo lo lleva.
const cuerpo = readFileSync(join(DIR, `${nombre}.html`), 'utf8').replace(/\n$/, '');
const asunto = readFileSync(join(DIR, `${nombre}.subject.txt`), 'utf8').replace(/\n$/, '');

const antes = await leerConfig();
const vivoCuerpo = antes[`mailer_templates_${nombre}_content`] ?? '';
const vivoAsunto = antes[`mailer_subjects_${nombre}`] ?? '';

const cambiaCuerpo = vivoCuerpo !== cuerpo;
const cambiaAsunto = vivoAsunto !== asunto;

console.log(`plantilla: ${nombre}`);
console.log(`  asunto  ${cambiaAsunto ? '≠' : '='}  vivo ${vivoAsunto.length} car. → repo ${asunto.length} car.`);
if (cambiaAsunto) {
  console.log(`      vivo: ${vivoAsunto.slice(0, 110)}`);
  console.log(`      repo: ${asunto.slice(0, 110)}`);
}
console.log(`  cuerpo  ${cambiaCuerpo ? '≠' : '='}  vivo ${vivoCuerpo.length} car. → repo ${cuerpo.length} car.`);

if (!cambiaCuerpo && !cambiaAsunto) {
  console.log('\nYa coincide. No hay nada que aplicar.');
  process.exit(0);
}
if (!confirmado) {
  console.log('\nEnsayo. Para aplicarlo de verdad: añade --si');
  process.exit(0);
}

const res = await fetch(URL_CFG, {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({
    [`mailer_subjects_${nombre}`]: asunto,
    [`mailer_templates_${nombre}_content`]: cuerpo,
  }),
});
if (!res.ok) {
  console.error(`\n[plantillas:aplicar] La API rechazó el cambio: ${res.status}`);
  console.error(`  ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}

// Releer SIEMPRE: un 200 dice que lo aceptó, no que lo guardó tal cual.
const despues = await leerConfig();
const okAsunto = (despues[`mailer_subjects_${nombre}`] ?? '') === asunto;
const okCuerpo = (despues[`mailer_templates_${nombre}_content`] ?? '') === cuerpo;
console.log(`\n  asunto guardado igual al repo: ${okAsunto ? 'sí' : 'NO'}`);
console.log(`  cuerpo guardado igual al repo: ${okCuerpo ? 'sí' : 'NO'}`);
if (!okAsunto || !okCuerpo) {
  console.error('\n[plantillas:aplicar] Aceptó el PATCH pero lo guardado NO coincide.');
  process.exit(1);
}
console.log('\n[plantillas:aplicar] Aplicada y verificada.');
