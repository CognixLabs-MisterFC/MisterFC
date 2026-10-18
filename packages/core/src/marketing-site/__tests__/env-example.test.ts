import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKETING_SITE_ENV_KEYS } from '../index';

/**
 * `apps/web/.env.example` lista TODAS las variables que lee el código de la web.
 *
 * Se escribía a mano y se quedaba atrás: el 18-10-2026 tenía 11 de 21 (faltaban, entre
 * otras, `MARKETING_SITE`, `CRON_SECRET`, las de VAPID y las de RevenueCat). Quien monta
 * el entorno local con él no sabía que existían.
 *
 * Las variables no se escriben aquí: se COPIAN del código (`process.env.X` en
 * `apps/web/src`, `packages/core/src` y la configuración de `apps/web`, sin tests ni
 * comentarios), más las del interruptor de la web, que las lee como `env.X`. Quedan fuera
 * las que pone la plataforma: `NODE_ENV` y `NEXT_RUNTIME` (Next), `VERCEL_ENV` (Vercel) y
 * `CI` (el CI).
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'apps/web/vercel.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro la raíz del repo subiendo desde ${process.cwd()}`);
}

const ROOT = repoRoot();
const DE_LA_PLATAFORMA = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL_ENV', 'CI']);

function ficheros(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre !== '__tests__' && nombre !== 'node_modules') out.push(...ficheros(ruta));
    } else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      out.push(ruta);
    }
  }
  return out;
}

function leidasEn(rutas: string[]): Set<string> {
  const leidas = new Set<string>();
  for (const ruta of rutas) {
    for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
      const t = linea.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
      for (const m of t.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) leidas.add(m[1] as string);
    }
  }
  return leidas;
}

const configWeb = readdirSync(join(ROOT, 'apps/web'))
  .filter((f) => /\.(ts|mjs)$/.test(f))
  .map((f) => join(ROOT, 'apps/web', f));

const leidas = [
  ...new Set([
    ...leidasEn([
      ...ficheros(join(ROOT, 'apps/web/src')),
      ...ficheros(join(ROOT, 'packages/core/src')),
      ...configWeb,
    ]),
    ...MARKETING_SITE_ENV_KEYS,
  ]),
]
  .filter((k) => !DE_LA_PLATAFORMA.has(k))
  .sort();

const enEjemplo = new Set(
  readFileSync(join(ROOT, 'apps/web/.env.example'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k)),
);

describe('apps/web/.env.example está completo', () => {
  it('premisa: el código lee las de Supabase y las del servidor', () => {
    expect(leidas).toEqual(
      expect.arrayContaining([
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'MARKETING_SITE',
      ]),
    );
  });

  it.each(leidas)('%s está en .env.example', (key) => {
    expect(enEjemplo.has(key)).toBe(true);
  });

  it('.env.example no tiene variables que el código ya no lee', () => {
    expect([...enEjemplo].filter((k) => !leidas.includes(k))).toEqual([]);
  });
});
