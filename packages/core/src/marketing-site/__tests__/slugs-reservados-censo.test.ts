import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CENSO — cada ruta de primer nivel bajo `/{idioma}` está en `is_reserved_slug`.
 *
 * QUÉ SE PROTEGE. Un club cuyo slug coincide con una ruta queda tapado: su login en
 * `misterfc.es/{slug}` sirve la ruta, no el club. La lista de reservados vive en SQL y
 * nadie la comparaba con las carpetas: cuando se escribió este test faltaban seis rutas
 * (spec de la web comercial, §2.2).
 *
 * CÓMO. Se COPIA la lista de los sitios que la definen, no se escribe a mano:
 *   · las carpetas de `apps/web/src/app/[locale]` (los grupos `(…)` se atraviesan);
 *   · el primer segmento fijo de cada `source` de `redirects()` en `next.config.ts`;
 *   · las exclusiones del `matcher` del middleware;
 * y se compara con el array de la ÚLTIMA migración que recrea `is_reserved_slug`.
 * Solo cuentan los nombres que un slug puede tomar (regex de `platform_create_club`).
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
/** La misma regex que valida el slug en `platform_create_club`. */
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

function segmentosDeRuta(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (/^\(.*\)$/.test(e.name)) out.push(...segmentosDeRuta(join(dir, e.name)));
    else if (!e.name.startsWith('[') && !e.name.startsWith('_') && !e.name.startsWith('@'))
      out.push(e.name);
  }
  return out;
}

function listaReservada(): { fichero: string; slugs: Set<string> } {
  const dir = join(ROOT, 'supabase/migrations');
  const fichero = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) =>
      /create or replace function public\.is_reserved_slug/i.test(
        readFileSync(join(dir, f), 'utf8'),
      ),
    )
    .at(-1);
  if (!fichero) throw new Error('ninguna migración define is_reserved_slug');
  const sql = readFileSync(join(dir, fichero), 'utf8');
  const cuerpo = sql.match(
    /function public\.is_reserved_slug[\s\S]*?any \(array\[([\s\S]*?)\]\)/i,
  )?.[1];
  if (!cuerpo) throw new Error(`no encuentro el array en ${fichero}`);
  const sinComentarios = cuerpo.replace(/--.*$/gm, '');
  return { fichero, slugs: new Set([...sinComentarios.matchAll(/'([^']+)'/g)].map((m) => m[1]!)) };
}

const RUTAS = segmentosDeRuta(join(ROOT, 'apps/web/src/app/[locale]'));
const REDIRECTS = [
  ...readFileSync(join(ROOT, 'apps/web/next.config.ts'), 'utf8').matchAll(/source:\s*'([^']+)'/g),
]
  .map((m) => m[1]!.split('/').filter((s) => s !== '' && !s.startsWith(':'))[0])
  .filter((s): s is string => s !== undefined);
const MATCHER = (
  readFileSync(join(ROOT, 'apps/web/src/middleware.ts'), 'utf8').match(/\(\?!([^)]*)\)/)?.[1] ?? ''
)
  .split('|')
  .map((s) => s.split('/')[0]!);
const { fichero, slugs } = listaReservada();

describe(`censo de slugs reservados (${fichero})`, () => {
  it('premisa: el censo encuentra rutas de los tres sitios, grupos incluidos', () => {
    expect(RUTAS).toEqual(expect.arrayContaining(['clubes', 'calendario', 'portada']));
    expect(REDIRECTS).toEqual(expect.arrayContaining(['abrir-invitacion', 'categorias', 'legal']));
    expect(MATCHER).toEqual(expect.arrayContaining(['api', 'monitoring', 'auth']));
    expect(slugs.size).toBeGreaterThan(60);
  });

  it('toda ruta que un club podría tomar como slug está reservada', () => {
    const candidatas = [...new Set([...RUTAS, ...REDIRECTS, ...MATCHER])].filter((s) =>
      SLUG_RE.test(s),
    );
    const faltan = candidatas.filter((s) => !slugs.has(s)).sort();
    expect(faltan).toEqual([]);
  });

  it('las reservas de la web comercial (spec §2.2) están', () => {
    for (const s of [
      'funciones',
      'seguridad',
      'demo',
      'portada',
      'precios',
      'contacto',
      'soporte',
      'ayuda',
      'blog',
      'empresa',
      'clientes',
    ]) {
      expect(slugs.has(s), s).toBe(true);
    }
  });
});
