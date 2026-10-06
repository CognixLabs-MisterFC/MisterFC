#!/usr/bin/env node
/**
 * GUARD — escribir cookies desde el render de un Server Component.
 *
 * POR QUÉ EXISTE: `/es` devolvía 500 en producción con
 *
 *     Error: Cookies can only be modified in a Server Action or Route Handler
 *
 * (digest 907647121, octubre 2026). El layout autenticado hacía, EN PLENO RENDER:
 *
 *     if (ctx.staleCookie) await rewriteStaleActiveClub(ctx.activeClub.club.id);
 *
 * `rewriteStaleActiveClub` vive en un fichero `'use server'`, y ahí estaba el
 * malentendido: esa directiva la hace invocable DESDE EL CLIENTE, no convierte en
 * Server Action una llamada hecha desde un Server Component. Era una llamada de
 * función normal, y el `cookies().set()` de dentro reventaba.
 *
 * Estaba DOS veces, en los dos layouts hermanos: `(authenticated)` con la cookie de
 * club activo y `spectator` con la del nieto activo. Y cada función tenía
 * exactamente un llamador, que era ese render: o sea que no es que fallaran a
 * veces, es que NUNCA pudieron funcionar.
 *
 * ── QUÉ COMPRUEBA ──────────────────────────────────────────────────────────
 *
 * Para cada `layout.tsx` / `page.tsx` de `apps/web/src/app` que NO sea `'use
 * client'` (o sea, los que se renderizan en el servidor):
 *
 *   1. que no escriba cookies él mismo (`cookieStore.set(`, `cookies().set(`);
 *   2. que no LLAME a nada importado de un módulo que escriba cookies.
 *
 * Lo segundo es lo que pilla este fallo, porque la escritura estaba a una llamada
 * de distancia. Importar sin llamar NO es rojo: pasar una Server Action como prop
 * a un componente de cliente es legítimo y frecuente — ahí sí se ejecuta donde
 * debe. Por eso se busca `nombre(` y no el import.
 *
 * Los route handlers (`route.ts`) y el middleware quedan fuera a propósito: ahí
 * mutar cookies es legal.
 *
 * SE QUITAN LOS COMENTARIOS ANTES DE BUSCAR, para que este guard no se dispare con
 * la explicación que los dos layouts dejan escrita sobre el fallo.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web/src');
const APP = join(WEB, 'app');

/** Módulos que escriben cookies pero a los que un render SÍ puede llamar. */
const CENSO_MODULOS = {
  'apps/web/src/lib/supabase-cookies.ts':
    'Su `setAll` envuelve cada `store.set` en try/catch silencioso justamente ' +
    'porque se usa desde Server Components; el refresh real lo hace el ' +
    'middleware. Llamar a `createCookieAdapter()` desde un render es correcto.',
};

const problemas = [];
const fallar = (m) => problemas.push('· ' + m);

function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function ficheros(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules') continue;
      ficheros(p, acc);
      continue;
    }
    if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

const ESCRIBE_COOKIE = /\b(?:cookieStore|store|cookieJar)\.set\(|\bcookies\(\)\.set\(/;

// ── 1. qué módulos escriben cookies ──────────────────────────────────────────
const escritores = new Set();
for (const file of ficheros(WEB)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (rel.endsWith('/middleware.ts') || rel.endsWith('/route.ts')) continue;
  if (ESCRIBE_COOKIE.test(sinComentarios(readFileSync(file, 'utf8')))) {
    escritores.add(rel);
  }
}

// Ancla positiva: si no encuentra ni un escritor, el escaneo está roto y un
// verde no significaría nada (siempre hay al menos los conmutadores de club).
if (escritores.size === 0) {
  fallar(
    'cero módulos que escriban cookies en apps/web/src: el escaneo está roto, ' +
      'no limpio. Al menos components/shell/actions.ts escribe la cookie de club.',
  );
}

/** Resuelve un especificador de import a una ruta del repo, o null si es externo. */
function resolverModulo(desde, spec) {
  let base = null;
  if (spec.startsWith('@/')) base = join(WEB, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(desde), spec);
  if (!base) return null;
  for (const cand of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) {
    if (existsSync(cand) && statSync(cand).isFile()) {
      return relative(ROOT, cand).split('\\').join('/');
    }
  }
  return null;
}

// ── 2. los renders del servidor ──────────────────────────────────────────────
let revisados = 0;
for (const file of ficheros(APP)) {
  const nombre = file.split('/').pop();
  if (nombre !== 'layout.tsx' && nombre !== 'page.tsx') continue;
  const bruto = readFileSync(file, 'utf8');
  if (/^\s*['"]use client['"]/m.test(bruto)) continue;
  revisados++;

  const rel = relative(ROOT, file).split('\\').join('/');
  const src = sinComentarios(bruto);

  if (ESCRIBE_COOKIE.test(src)) {
    fallar(
      `${rel}: escribe cookies en el render. Next lanza «Cookies can only be ` +
        'modified in a Server Action or Route Handler» y la página da 500.',
    );
  }

  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const mod = resolverModulo(file, m[2]);
    if (!mod || !escritores.has(mod) || mod in CENSO_MODULOS) continue;
    for (let sym of m[1].split(',')) {
      sym = sym.trim().split(/\s+as\s+/).pop()?.trim() ?? '';
      if (!sym || sym === 'type') continue;
      const llamada = new RegExp(`\\b${sym.replace(/[^\w$]/g, '')}\\s*\\(`);
      if (llamada.test(src)) {
        fallar(
          `${rel}: LLAMA a \`${sym}()\`, de ${mod}, que escribe cookies. Desde el ` +
            'render no se puede: `\'use server\'` en el fichero de origen NO ' +
            'convierte esta llamada en Server Action. Si la cookie puede esperar, ' +
            'no la escribas (el resolver ya cae al primer elemento); si no, hazlo ' +
            'en un route handler o en el middleware.',
        );
      }
    }
  }
}

if (revisados === 0) {
  fallar('cero layout.tsx/page.tsx de servidor revisados: el escaneo está roto.');
}

if (problemas.length > 0) {
  console.error('\n[cookies-en-render] Escritura de cookies durante el render:\n');
  for (const p of problemas) console.error('  ' + p);
  console.error('');
  process.exit(1);
}

console.log(
  `[cookies-en-render] OK — ${revisados} render(s) de servidor revisados contra ` +
    `${escritores.size} módulo(s) que escriben cookies (${Object.keys(CENSO_MODULOS).length} censado(s)).`,
);
process.exit(0);
