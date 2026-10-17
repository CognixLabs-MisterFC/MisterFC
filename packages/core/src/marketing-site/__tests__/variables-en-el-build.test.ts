import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMarketingSiteOn, MARKETING_SITE_ENV_KEYS } from '../index';

/**
 * Vercel compila con `turbo run build`, y Turborepo (modo estricto) solo deja ver al
 * build las variables declaradas en `turbo.json`. Lo que se genera al compilar —el
 * sitemap, las legales de la web (aviso legal y cookies) y `/demo/gracias`— llama a
 * `isMarketingSiteOn` en ese momento: si sus variables no llegan, sale apagado aunque
 * la web esté encendida. Pasó en producción el 17-10-2026 (sitemap de 4 URLs, esas
 * páginas en 404 y el formulario de demo acabando en un 404).
 *
 * Las variables que se exigen no se escriben aquí: se apuntan las que el interruptor
 * LEE de verdad, así que una tercera que se le añada sin declararla pone esto en rojo.
 */
const turbo = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../turbo.json', import.meta.url)), 'utf8'),
) as { tasks: Record<string, { env?: string[] }> };

/** Las claves que lee `isMarketingSiteOn`, recorriendo sus tres ramas. */
function clavesLeidas(): Set<string> {
  const leidas = new Set<string>();
  for (const valores of [
    { MARKETING_SITE: 'on' },
    { MARKETING_SITE: 'off' },
    { VERCEL_ENV: 'preview' },
    {},
  ] as Record<string, string>[]) {
    const env = new Proxy(valores, {
      get(target, key) {
        if (typeof key === 'string') leidas.add(key);
        return target[key as string];
      },
    });
    isMarketingSiteOn(env);
  }
  return leidas;
}

describe('las variables de la web comercial llegan al build', () => {
  it('premisa: turbo.json tiene la tarea build y el interruptor lee alguna variable', () => {
    expect(turbo.tasks.build).toBeDefined();
    expect(clavesLeidas().size).toBeGreaterThan(0);
  });

  it('MARKETING_SITE_ENV_KEYS son exactamente las variables que lee el interruptor', () => {
    expect([...clavesLeidas()].sort()).toEqual([...MARKETING_SITE_ENV_KEYS].sort());
  });

  it.each([...MARKETING_SITE_ENV_KEYS])(
    '%s está declarada en la tarea build de turbo.json',
    (key) => {
      expect(turbo.tasks.build?.env ?? []).toContain(key);
    },
  );
});
