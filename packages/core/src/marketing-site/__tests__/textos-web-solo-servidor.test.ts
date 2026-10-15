import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CENSO — los textos de la web comercial (`webComercial`) no viajan al navegador.
 *
 * El layout raíz de `[locale]` los quita de lo que recibe `NextIntlClientProvider`: así
 * no engordan el HTML de cada pantalla de la app, y con la web apagada el HTML es el de
 * antes. La contrapartida: un componente `'use client'` que pida `webComercial` no
 * encontraría nada y pintaría la clave en pantalla, sin error en el build. Este censo
 * lo impide; los componentes de cliente reciben sus textos por props.
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

function ficheros(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) ficheros(f, out);
    else if (/\.tsx?$/.test(e)) out.push(f);
  }
  return out;
}

const ROOT = repoRoot();
const SRC = join(ROOT, 'apps/web/src');
const todos = ficheros(SRC);
const cliente = todos.filter((f) => /^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8')));

describe('textos de la web comercial: solo en el servidor', () => {
  it('premisa: hay componentes de cliente, y el selector de idioma es uno', () => {
    expect(cliente.length).toBeGreaterThan(20);
    expect(cliente.some((f) => f.endsWith('components/web/language-switcher.tsx'))).toBe(true);
  });

  it('ningún componente de cliente pide `webComercial`', () => {
    const malos = cliente
      .filter((f) => readFileSync(f, 'utf8').includes('webComercial'))
      .map((f) => f.slice(SRC.length + 1));
    expect(malos).toEqual([]);
  });

  it('el layout raíz sigue quitando `webComercial` de los mensajes del navegador', () => {
    const src = readFileSync(join(SRC, 'app/[locale]/layout.tsx'), 'utf8');
    expect(src).toContain("filter(([namespace]) => namespace !== 'webComercial')");
    expect(src).toContain('<NextIntlClientProvider messages={clientMessages}>');
  });
});
