import { describe, expect, it } from 'vitest';
import {
  lookupMessage,
  pluralCategory,
  formatICU,
  translate,
  type Messages,
} from '../format';

const CAT: Messages = {
  perfil: {
    title: 'Mi perfil',
    avatar: { hint: 'JPG, PNG o WebP. Máximo {maxMb} MB.' },
  },
  home: {
    unread: '{count, plural, =0 {Sin novedades} one {1 novedad} other {# novedades}}',
    saludo: 'Hola {name}',
  },
  va: { app: "Actualitza l'app quan puguis" },
};

describe('lookupMessage', () => {
  it('resuelve claves anidadas', () => {
    expect(lookupMessage(CAT, 'perfil.avatar.hint')).toBe('JPG, PNG o WebP. Máximo {maxMb} MB.');
    expect(lookupMessage(CAT, 'perfil.title')).toBe('Mi perfil');
  });
  it('devuelve null si no existe o no es hoja', () => {
    expect(lookupMessage(CAT, 'perfil.nope')).toBeNull();
    expect(lookupMessage(CAT, 'perfil.avatar')).toBeNull(); // es objeto, no hoja
    expect(lookupMessage(CAT, 'x.y.z')).toBeNull();
  });
});

describe('pluralCategory (es/en/va misma regla)', () => {
  it('one si n===1, other en el resto', () => {
    expect(pluralCategory(1, 'es')).toBe('one');
    expect(pluralCategory(0, 'es')).toBe('other');
    expect(pluralCategory(2, 'en')).toBe('other');
    expect(pluralCategory(5, 'va')).toBe('other');
  });
});

describe('formatICU — interpolación', () => {
  it('sustituye variables simples', () => {
    expect(formatICU('Hola {name}', { name: 'Ada' }, 'es')).toBe('Hola Ada');
  });
  it('convierte números a string', () => {
    expect(formatICU('MB: {maxMb}', { maxMb: 2 }, 'es')).toBe('MB: 2');
  });
  it('variable ausente → vacío', () => {
    expect(formatICU('Hola {name}', {}, 'es')).toBe('Hola ');
  });
});

describe('formatICU — plural con # y =N', () => {
  const t = CAT.home as Messages;
  const tpl = t.unread as string;
  it('=0 exacto', () => {
    expect(formatICU(tpl, { count: 0 }, 'es')).toBe('Sin novedades');
  });
  it('one', () => {
    expect(formatICU(tpl, { count: 1 }, 'es')).toBe('1 novedad');
  });
  it('other con # sustituido por el número', () => {
    expect(formatICU(tpl, { count: 7 }, 'es')).toBe('7 novedades');
  });
});

describe('formatICU — select', () => {
  const tpl = '{gender, select, male {Bienvenido} female {Bienvenida} other {Te damos la bienvenida}}';
  it('rama concreta', () => {
    expect(formatICU(tpl, { gender: 'female' }, 'es')).toBe('Bienvenida');
  });
  it('fallback a other', () => {
    expect(formatICU(tpl, { gender: 'x' }, 'es')).toBe('Te damos la bienvenida');
  });
});

describe('formatICU — apóstrofos ICU (valencià)', () => {
  it('apóstrofo suelto es literal', () => {
    expect(formatICU("Actualitza l'app quan puguis", {}, 'va')).toBe("Actualitza l'app quan puguis");
  });
  it("'' escapa a un apóstrofo", () => {
    expect(formatICU("d''ací", {}, 'va')).toBe("d'ací");
  });
  it("'{ inicia literal citado (no se interpreta la llave)", () => {
    expect(formatICU("literal '{name}'", { name: 'X' }, 'es')).toBe('literal {name}');
  });
});

describe('translate (con namespace)', () => {
  it('resuelve namespace + clave e interpola', () => {
    expect(translate(CAT, 'perfil', 'avatar.hint', { maxMb: 2 }, 'es')).toBe(
      'JPG, PNG o WebP. Máximo 2 MB.',
    );
  });
  it('sin namespace', () => {
    expect(translate(CAT, undefined, 'perfil.title', {}, 'es')).toBe('Mi perfil');
  });
  it('clave inexistente → devuelve la clave completa (fallback visible)', () => {
    expect(translate(CAT, 'perfil', 'no.existe', {}, 'es')).toBe('perfil.no.existe');
  });
});
