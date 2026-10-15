import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildWebManifest, isMarketingSiteOn, marketingRootDecision } from '../index';

const LOCALES = ['es', 'en', 'va'] as const;

describe('isMarketingSiteOn — el interruptor de la web comercial', () => {
  it('PRODUCCIÓN sin variable → APAGADA (misterfc.es como siempre)', () => {
    expect(isMarketingSiteOn({ VERCEL_ENV: 'production' })).toBe(false);
  });

  it('local sin variable → apagada', () => {
    expect(isMarketingSiteOn({})).toBe(false);
  });

  it('vista previa sin variable → encendida', () => {
    expect(isMarketingSiteOn({ VERCEL_ENV: 'preview' })).toBe(true);
  });

  it('`on` la enciende en cualquier entorno, también en producción', () => {
    expect(isMarketingSiteOn({ MARKETING_SITE: 'on', VERCEL_ENV: 'production' })).toBe(true);
    expect(isMarketingSiteOn({ MARKETING_SITE: ' ON ' })).toBe(true);
  });

  it('`off` la apaga en cualquier entorno, también en la vista previa', () => {
    expect(isMarketingSiteOn({ MARKETING_SITE: 'off', VERCEL_ENV: 'preview' })).toBe(false);
  });

  it('un valor mal escrito en producción NO la enciende (falla cerrada)', () => {
    for (const v of ['true', '1', 'yes', 'encendida', '']) {
      expect(isMarketingSiteOn({ MARKETING_SITE: v, VERCEL_ENV: 'production' })).toBe(false);
    }
  });
});

describe('marketingRootDecision — la raíz de cada idioma', () => {
  const decide = (pathname: string, signedIn: boolean, siteOn: boolean) =>
    marketingRootDecision(pathname, { locales: LOCALES, signedIn, siteOn });

  it('APAGADA: el anónimo en /{idioma} va a /{idioma}/clubes con 307, como antes', () => {
    for (const l of LOCALES) {
      expect(decide(`/${l}`, false, false)).toEqual({
        kind: 'redirect',
        to: `/${l}/clubes`,
        status: 307,
      });
    }
  });

  it('ENCENDIDA: el anónimo en /{idioma} ve la portada sin cambiar de URL', () => {
    for (const l of LOCALES) {
      expect(decide(`/${l}`, false, true)).toEqual({ kind: 'rewrite', to: `/${l}/portada` });
    }
  });

  it('con sesión, /{idioma} es el Inicio de la app, encendida o apagada', () => {
    expect(decide('/es', true, false)).toEqual({ kind: 'next' });
    expect(decide('/es', true, true)).toEqual({ kind: 'next' });
  });

  it('ENCENDIDA: /{idioma}/portada da 308 a /{idioma}, con sesión y sin ella', () => {
    expect(decide('/va/portada', false, true)).toEqual({
      kind: 'redirect',
      to: '/va',
      status: 308,
    });
    expect(decide('/en/portada', true, true)).toEqual({ kind: 'redirect', to: '/en', status: 308 });
  });

  it('APAGADA: /{idioma}/portada sigue su camino (cae en /{slug}, como antes)', () => {
    expect(decide('/es/portada', false, false)).toEqual({ kind: 'next' });
  });

  it('no toca nada más: clubes, slugs, rutas de la app, subrutas de portada, otros idiomas', () => {
    for (const p of [
      '/es/clubes',
      '/es/udfonteta',
      '/es/calendario',
      '/es/portada/x',
      '/ca',
      '/',
      '/fr/portada',
      '/es/demo',
      '/es/demo/gracias/x',
      '/fr/demo/gracias',
    ]) {
      expect(decide(p, false, true)).toEqual({ kind: 'next' });
      expect(decide(p, false, false)).toEqual({ kind: 'next' });
    }
  });

  it('APAGADA: /{idioma}/demo/gracias va a una ruta que no existe (el 404 de antes)', () => {
    for (const l of LOCALES) {
      for (const signedIn of [false, true]) {
        expect(decide(`/${l}/demo/gracias`, signedIn, false)).toEqual({
          kind: 'rewrite',
          to: `/${l}/demo/gracias/__sin-ruta`,
        });
      }
    }
  });

  it('ENCENDIDA: /{idioma}/demo/gracias sigue su camino', () => {
    expect(decide('/es/demo/gracias', false, true)).toEqual({ kind: 'next' });
    expect(decide('/va/demo/gracias', true, true)).toEqual({ kind: 'next' });
  });
});

describe('buildWebManifest — /manifest.json', () => {
  const antes = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('./fixtures/manifest-antes-de-la-web-comercial.json', import.meta.url)),
      'utf8',
    ),
  ) as Record<string, unknown>;

  it('premisa: la copia del manifiesto de antes arranca en "/"', () => {
    expect(antes.start_url).toBe('/');
  });

  it('APAGADA: es idéntico, campo a campo, al de antes de la web comercial', () => {
    expect(buildWebManifest({ VERCEL_ENV: 'production' })).toEqual(antes);
  });

  it('ENCENDIDA: solo cambia start_url, a /clubes (la PWA sigue en el selector)', () => {
    expect(buildWebManifest({ MARKETING_SITE: 'on' })).toEqual({ ...antes, start_url: '/clubes' });
  });
});
