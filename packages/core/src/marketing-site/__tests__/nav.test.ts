import { describe, expect, it } from 'vitest';
import { localeSwitchHref } from '../index';

const L = ['es', 'en', 'va'] as const;

describe('localeSwitchHref — la misma página en otro idioma', () => {
  it('portada: /es → /va (la portada vive en /{idioma})', () => {
    expect(localeSwitchHref('/es', 'va', L)).toBe('/va');
  });

  it('páginas comerciales: solo cambia el idioma, el slug no se traduce', () => {
    expect(localeSwitchHref('/es/funciones', 'en', L)).toBe('/en/funciones');
    expect(localeSwitchHref('/va/demo/gracias', 'es', L)).toBe('/es/demo/gracias');
  });

  it('barra final o dobles barras no dejan segmentos vacíos', () => {
    expect(localeSwitchHref('/es/', 'en', L)).toBe('/en');
    expect(localeSwitchHref('/es//seguridad/', 'va', L)).toBe('/va/seguridad');
  });

  it('sin idioma reconocible → raíz del idioma pedido, nunca una URL inventada', () => {
    expect(localeSwitchHref('/', 'va', L)).toBe('/va');
    expect(localeSwitchHref('/fr/funciones', 'en', L)).toBe('/en');
    expect(localeSwitchHref('', 'es', L)).toBe('/es');
  });

  it('al mismo idioma devuelve la misma página', () => {
    expect(localeSwitchHref('/en/seguridad', 'en', L)).toBe('/en/seguridad');
  });
});
