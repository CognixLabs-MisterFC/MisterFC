import { describe, it, expect } from 'vitest';
import {
  ROLLING_REGIME,
  DEFAULT_REGIME,
  limitedRegime,
  canRegisterSubstitution,
  subsRemaining,
} from '../regime';

describe('régimen corrido (rolling)', () => {
  it('permite reentrada y cambios ilimitados', () => {
    expect(ROLLING_REGIME.allowReentry).toBe(true);
    expect(ROLLING_REGIME.maxSubs).toBeNull();
    // Ilimitado: siempre se puede registrar otro cambio.
    expect(canRegisterSubstitution(ROLLING_REGIME, 0)).toBe(true);
    expect(canRegisterSubstitution(ROLLING_REGIME, 25)).toBe(true);
    expect(subsRemaining(ROLLING_REGIME, 10)).toBeNull();
  });
});

describe('régimen limitado (7 cambios, sin reentrada)', () => {
  const r = limitedRegime(7);

  it('no permite reentrada', () => {
    expect(r.allowReentry).toBe(false);
    expect(r.type).toBe('limited');
  });

  it('permite hasta el 7º cambio y corta el 8º', () => {
    // 0..6 hechos → aún cabe el siguiente (el 1º..7º).
    for (let done = 0; done < 7; done += 1) {
      expect(canRegisterSubstitution(r, done)).toBe(true);
    }
    // Con 7 ya hechos, el 8º se bloquea.
    expect(canRegisterSubstitution(r, 7)).toBe(false);
    expect(canRegisterSubstitution(r, 8)).toBe(false);
  });

  it('cuenta los cambios restantes', () => {
    expect(subsRemaining(r, 0)).toBe(7);
    expect(subsRemaining(r, 3)).toBe(4);
    expect(subsRemaining(r, 7)).toBe(0);
    expect(subsRemaining(r, 9)).toBe(0); // nunca negativo
  });
});

/**
 * El régimen POR DEFECTO: el que se aplica cuando no hay fila en
 * `substitution_regimes` para (categoría, división).
 *
 * Estuvo en corrido y era el fallo del lado equivocado: un hueco en los datos de
 * referencia regalaba cambios ilimitados con reentrada, sin un error y sin un aviso.
 * Le pasó a `senior`, que no tenía ni una fila, y nadie lo habría notado salvo mirando
 * la tabla. La regla confirmada es que el corrido es la EXCEPCIÓN, así que el valor por
 * defecto correcto es también el seguro.
 *
 * Estos casos existen para que volver a ponerlo en corrido —por "coherencia con el
 * default histórico", que es lo que decía el comentario anterior— no pueda pasar
 * inadvertido en una revisión de código.
 */
describe('régimen por defecto (sin fila en el catálogo)', () => {
  it('es LIMITADO, no corrido', () => {
    expect(DEFAULT_REGIME.type).toBe('limited');
  });

  it('tope de 7 y sin reentrada', () => {
    expect(DEFAULT_REGIME.maxSubs).toBe(7);
    expect(DEFAULT_REGIME.allowReentry).toBe(false);
  });

  it('NO es el régimen corrido', () => {
    // Comparación por valor y no por identidad: así también salta si alguien define
    // un objeto nuevo con la forma del corrido en vez de reutilizar la constante.
    expect(DEFAULT_REGIME).not.toEqual(ROLLING_REGIME);
    expect(DEFAULT_REGIME.maxSubs).not.toBeNull();
  });

  it('se comporta como limitado al contar cambios', () => {
    // Lo que de verdad importa no es la forma del objeto, es la consecuencia: el
    // octavo cambio no entra y el séptimo deja cero restantes.
    expect(canRegisterSubstitution(DEFAULT_REGIME, 0)).toBe(true);
    expect(canRegisterSubstitution(DEFAULT_REGIME, 6)).toBe(true);
    expect(canRegisterSubstitution(DEFAULT_REGIME, 7)).toBe(false);
    expect(subsRemaining(DEFAULT_REGIME, 0)).toBe(7);
    expect(subsRemaining(DEFAULT_REGIME, 7)).toBe(0);
    expect(subsRemaining(DEFAULT_REGIME, 99)).toBe(0);
  });

  it('es equivalente a limitedRegime(7)', () => {
    expect(DEFAULT_REGIME).toEqual(limitedRegime(7));
  });
});
