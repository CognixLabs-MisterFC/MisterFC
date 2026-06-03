import { describe, it, expect } from 'vitest';
import {
  ROLLING_REGIME,
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
