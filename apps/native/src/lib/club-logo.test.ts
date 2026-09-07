import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CREST_WIDTH, clubCrestUrls, clubInitials } from './club-logo';

/**
 * F14J-5A — URLs del escudo y sus iniciales de respaldo.
 *
 * `EXPO_PUBLIC_SUPABASE_URL` la inlinea Metro en el build; en Node sale de
 * `process.env` y `clubCrestUrls` la lee EN CADA LLAMADA, asi que aqui se fija a
 * un valor de mentira y los tests corren siempre — no dependen de que la maquina
 * tenga configurado el entorno real.
 */
const BASE = 'https://proyecto.supabase.co';
const previo = process.env.EXPO_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = BASE;
});

afterEach(() => {
  if (previo === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = previo;
});

describe('clubCrestUrls', () => {
  it('sin path no hay escudo', () => {
    expect(clubCrestUrls(null, CREST_WIDTH.row)).toBeNull();
    expect(clubCrestUrls(undefined, CREST_WIDTH.row)).toBeNull();
    expect(clubCrestUrls('', CREST_WIDTH.row)).toBeNull();
  });

  it('pide la variante redimensionada y guarda la original', () => {
    const urls = clubCrestUrls('club-id/escudo.png', CREST_WIDTH.hero);
    expect(urls).not.toBeNull();
    // La transformada lleva el width pedido y sale por /render/image/.
    expect(urls!.primary).toBe(
      `${BASE}/storage/v1/render/image/public/club-logos/club-id/escudo.png` +
        `?width=${CREST_WIDTH.hero}&height=${CREST_WIDTH.hero}&resize=contain`
    );
    // La de respaldo es el objeto tal cual, sin transformar.
    expect(urls!.fallback).toBe(
      `${BASE}/storage/v1/object/public/club-logos/club-id/escudo.png`
    );
  });

  it('las dos anchuras dan URLs distintas', () => {
    const row = clubCrestUrls('c/e.png', CREST_WIDTH.row)!;
    const hero = clubCrestUrls('c/e.png', CREST_WIDTH.hero)!;
    expect(row.primary).not.toBe(hero.primary);
    // Pero el respaldo es el mismo objeto: solo cambia lo que se pide servido.
    expect(row.fallback).toBe(hero.fallback);
  });

  it('escapa cada segmento sin comerse las barras', () => {
    const urls = clubCrestUrls('club id/mi escudo.png', CREST_WIDTH.row)!;
    expect(urls.fallback).toContain('club%20id/mi%20escudo.png');
  });

  it('sin URL base no se inventa una URL rota', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(clubCrestUrls('c/e.png', CREST_WIDTH.row)).toBeNull();
  });

  it('las anchuras servidas son mucho menores que el original', () => {
    // No es un test de red: fija la INTENCIÓN. El escudo real de producción pesa
    // 913 KB; a 96 px son 8 KB y a 192 px, 31 KB. Si alguien sube estos números
    // sin querer, que se note aquí.
    expect(CREST_WIDTH.row).toBeLessThanOrEqual(96);
    expect(CREST_WIDTH.hero).toBeLessThanOrEqual(192);
    expect(CREST_WIDTH.row).toBeLessThan(CREST_WIDTH.hero);
  });
});

describe('clubInitials', () => {
  it('dos palabras → dos iniciales', () => {
    expect(clubInitials('Union Deportiva Fonteta')).toBe('UD');
  });

  it('una palabra → sus dos primeras letras', () => {
    expect(clubInitials('UDFonteta')).toBe('UD');
  });

  it('aguanta espacios de sobra y cadenas vacías', () => {
    expect(clubInitials('   Club   Beta   ')).toBe('CB');
    expect(clubInitials('   ')).toBe('?');
    expect(clubInitials('')).toBe('?');
  });
});
