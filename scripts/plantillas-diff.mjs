#!/usr/bin/env node
/**
 * Compara `supabase/emails/` (la copia revisada del repo) con lo que hay VIVO en
 * el dashboard de Supabase.
 *
 * SOLO LEE. No escribe, no despliega, no toca la configuración. Si algo difiere,
 * lo dice y se pega a mano — que es justo la decisión que hay tomada.
 *
 * NO corre en CI: el workflow no tiene secretos (a propósito). Esto se lanza a
 * mano, y conviene hacerlo al tocar una plantilla y de vez en cuando, porque una
 * copia que nadie compara acaba siendo una copia que miente.
 *
 *   pnpm plantillas:diff
 *
 * Necesita SUPABASE_ACCESS_TOKEN y SUPABASE_PROJECT_REF: del entorno, o de
 * `apps/web/.env.local` si no están puestas.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR = join(ROOT, 'supabase/emails');
const TEMPLATES = ['invite', 'recovery', 'magic_link'];

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
  console.error(
    '[plantillas:diff] Faltan SUPABASE_ACCESS_TOKEN o SUPABASE_PROJECT_REF ' +
      '(entorno o apps/web/.env.local).',
  );
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`[plantillas:diff] La API respondió ${res.status}.`);
  process.exit(2);
}
const cfg = await res.json();

/** Primera línea que difiere, para no volcar 6 KB de HTML en la terminal. */
function primeraDiferencia(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return {
        linea: i + 1,
        repo: la[i] === undefined ? '(no hay más líneas)' : la[i].trim().slice(0, 120),
        vivo: lb[i] === undefined ? '(no hay más líneas)' : lb[i].trim().slice(0, 120),
      };
    }
  }
  return null;
}

let difieren = 0;
for (const t of TEMPLATES) {
  for (const [que, ext, clave] of [
    ['cuerpo', 'html', `mailer_templates_${t}_content`],
    ['asunto', 'subject.txt', `mailer_subjects_${t}`],
  ]) {
    // El dashboard guarda sin el salto final; el fichero del repo lo lleva.
    const repo = readFileSync(join(DIR, `${t}.${ext}`), 'utf8').replace(/\n$/, '');
    const vivo = (cfg[clave] ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '');

    if (repo === vivo) {
      console.log(`  = ${t} · ${que}`);
      continue;
    }
    difieren++;
    const d = primeraDiferencia(repo, vivo);
    console.log(`  ≠ ${t} · ${que}  (repo ${repo.length} car., vivo ${vivo.length} car.)`);
    if (d) {
      console.log(`      línea ${d.linea}`);
      console.log(`      repo: ${d.repo}`);
      console.log(`      vivo: ${d.vivo}`);
    }
  }
}

console.log('');
if (difieren === 0) {
  console.log('[plantillas:diff] El dashboard coincide con la copia del repo.');
  process.exit(0);
}
console.log(
  `[plantillas:diff] ${difieren} difieren. Si la buena es la del repo, pégala en\n` +
    `  Supabase → Authentication → Emails. Si la buena es la viva, tráela al repo\n` +
    '  en un PR para que quede el diff.',
);
process.exit(1);
