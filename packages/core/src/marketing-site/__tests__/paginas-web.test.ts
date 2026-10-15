import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKETING_SUBPAGES } from '../site';

/**
 * CENSO de las páginas de la web comercial y de sus textos.
 *
 * 1. Con `MARKETING_SITE` apagada, misterfc.es tiene que responder lo de antes. Cada
 *    carpeta de `(web)` le gana a `[slug]`, así que cada página DEBE delegar en la página
 *    de `[slug]` con su propio nombre. Una página nueva que lo olvide saldría en
 *    producción con el interruptor apagado.
 * 2. Los textos de la web no llevan precios (spec §1), no dicen que la app sea gratuita
 *    (corrección del 2026-10-15, §13.3) y no anuncian lo que §5.3 deja fuera.
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
const WEB = join(ROOT, 'apps/web/src/app/[locale]/(web)');
const paginas = readdirSync(WEB).filter(
  (d) =>
    !d.startsWith('_') &&
    statSync(join(WEB, d)).isDirectory() &&
    existsSync(join(WEB, d, 'page.tsx')),
);

/** Páginas más hondas (`demo/gracias`): bajo `[slug]` no había nada, así que eran un 404. */
function subpaginas(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (e.startsWith('_') || !statSync(f).isDirectory()) continue;
    const r = rel ? `${rel}/${e}` : e;
    if (rel && existsSync(join(f, 'page.tsx'))) out.push(r);
    out.push(...subpaginas(f, r));
  }
  return out;
}
const hondas = subpaginas(WEB);

/**
 * Las legales de la web comercial (`ambito: 'web'` en `scripts/textos-legales.mjs`)
 * viven en `legal/`, fuera de `(web)`, para llevar el layout de las legales. Se leen del
 * censo de textos legales, no de una lista a mano.
 */
const LOCALE = join(ROOT, 'apps/web/src/app/[locale]');
const LEGALES_WEB = [
  ...readFileSync(join(ROOT, 'scripts/textos-legales.mjs'), 'utf8').matchAll(
    /servido: '([^']+)', ambito: 'web' \}/g,
  ),
].map((m) => `legal/${m[1]}`);

describe('páginas de la web comercial con el interruptor apagado', () => {
  it('premisa: el censo encuentra las páginas', () => {
    expect(paginas).toEqual(expect.arrayContaining(['portada', 'funciones', 'seguridad', 'demo']));
    expect(hondas).toEqual(expect.arrayContaining(['demo/gracias']));
    expect(LEGALES_WEB).toEqual(['legal/aviso-legal', 'legal/cookies']);
  });

  it('cada subpágina está en MARKETING_SUBPAGES: el middleware le da el 404 de antes', () => {
    expect([...MARKETING_SUBPAGES].sort()).toEqual([...hondas, ...LEGALES_WEB].sort());
  });

  it.each([...MARKETING_SUBPAGES])('%s además da 404 por sí misma cuando está apagada', (p) => {
    const enWeb = join(WEB, p, 'page.tsx');
    const src = readFileSync(existsSync(enWeb) ? enWeb : join(LOCALE, p, 'page.tsx'), 'utf8');
    expect(src).toContain('if (!isMarketingSiteOn(process.env)) notFound();');
  });

  it.each(paginas)('%s delega en [slug] con su propio nombre cuando está apagada', (p) => {
    const src = readFileSync(join(WEB, p, 'page.tsx'), 'utf8');
    expect(src).toContain('if (!isMarketingSiteOn(process.env)) {');
    expect(src).toContain(`ClubLoginPage({ params: Promise.resolve({ locale, slug: '${p}' }) })`);
    expect(src).toContain("import ClubLoginPage from '../../[slug]/page';");
  });
});

describe('textos de la web comercial', () => {
  const textos = ['es', 'va', 'en'].map((l) => ({
    l,
    src: readFileSync(join(ROOT, `apps/web/messages-web/${l}.json`), 'utf8'),
  }));

  it('premisa: los tres catálogos tienen contenido', () => {
    for (const { src } of textos) expect(src.length).toBeGreaterThan(5000);
  });

  it.each(textos)('$l: sin precios, sin «gratuita» y sin lo que §5.3 no anuncia', ({ src }) => {
    const prohibidos = [
      /€|\beuros?\b|\d+\s?EUR/i,
      /gratu[iï]t|\bgratis\b|\bfree\b/i,
      /intel·?lig[eè]ncia artificial|inteligencia artificial|artificial intelligence|\bIA\b|\bAI\b/,
      /FFCV/,
    ];
    for (const re of prohibidos) expect(src).not.toMatch(re);
  });
});
