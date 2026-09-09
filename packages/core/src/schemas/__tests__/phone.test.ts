import { describe, expect, it } from 'vitest';
import { isValidPhone, normalizePhone, phoneOptionalField } from '../phone';

/**
 * El criterio del teléfono está escrito DOS veces: aquí y en el CHECK de la
 * migración 20261057000000. Es a propósito —el formulario tiene que poder avisar
 * antes de enviar— y por eso conviene fijar los mismos casos que fija el guard
 * de la migración: si alguien afloja uno de los dos lados, esto lo canta.
 */
describe('isValidPhone — el mismo criterio que el CHECK de la base', () => {
  it('acepta los formatos que la gente escribe de verdad', () => {
    for (const bueno of [
      '600123456', // móvil español tal cual
      '+34 600 123 456', // con prefijo y espacios
      '(+34) 600-123-456', // con paréntesis y guiones
      '+44 20 7946 0958', // extranjero
      '+1 415 555 2671', // extranjero, otro formato
      '96 123 45 67', // fijo
    ]) {
      expect(isValidPhone(bueno), bueno).toBe(true);
    }
  });

  it('rechaza lo que no es un teléfono', () => {
    for (const malo of [
      '', // vacío
      '   ',
      '12345', // cinco dígitos
      'llamar al club', // letras
      '600123456 ext 12', // letras camufladas
      '1234567890123456', // 16 dígitos: por encima de E.164
    ]) {
      expect(isValidPhone(malo), malo).toBe(false);
    }
  });

  it('no presupone España: no exige prefijo ni longitud nacional', () => {
    expect(isValidPhone('+351 912 345 678')).toBe(true);
    expect(isValidPhone('123456')).toBe(true);
  });
});

describe('normalizePhone — el vacío va como NULL', () => {
  it('un campo en blanco es NULL, no cadena vacía', () => {
    // La columna tiene un CHECK que rechaza '': mandarla sería un 23514.
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('quita los espacios de los extremos y NADA más', () => {
    // No se reformatea: lo que teclea el tutor es lo que verá el entrenador.
    expect(normalizePhone('  +34 600 123 456 ')).toBe('+34 600 123 456');
  });
});

describe('phoneOptionalField — el del perfil y el del jugador', () => {
  it('vacío o ausente pasa, y llega como null', () => {
    expect(phoneOptionalField.parse('')).toBeNull();
    expect(phoneOptionalField.parse(undefined)).toBeNull();
    expect(phoneOptionalField.parse(null)).toBeNull();
  });

  it('si hay algo, tiene que valer', () => {
    expect(phoneOptionalField.parse('600 123 456')).toBe('600 123 456');
    const r = phoneOptionalField.safeParse('12345');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('phone_invalid');
  });
});
