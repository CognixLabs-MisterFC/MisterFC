import { describe, expect, it } from 'vitest';
import { hasLinkedFamily, isTutorAccount, TUTOR_RELATIONS } from '../family-link';

describe('hasLinkedFamily', () => {
  it('true con al menos una cuenta, false sin cuentas', () => {
    expect(hasLinkedFamily([{ profile_id: 'a' }])).toBe(true);
    expect(hasLinkedFamily([{ profile_id: 'a' }, { profile_id: 'b' }])).toBe(true);
    expect(hasLinkedFamily([])).toBe(false);
    expect(hasLinkedFamily(null)).toBe(false);
    expect(hasLinkedFamily(undefined)).toBe(false);
  });
});

describe('isTutorAccount — quién sale en la lista de Familia', () => {
  it('los dos tutores entran', () => {
    expect(isTutorAccount({ relation: 'parent' })).toBe(true);
    expect(isTutorAccount({ relation: 'guardian' })).toBe(true);
  });

  // El caso por el que existe: la cuenta propia del menor (serie MN) es una fila
  // más de player_accounts y salía como un tutor, con el correo del padre dentro.
  it('la cuenta propia del menor NO', () => {
    expect(isTutorAccount({ relation: 'self' })).toBe(false);
  });

  // En positivo: un cuarto valor tendría que pedir entrar, no entrar solo.
  it('un valor que no conocemos tampoco entra', () => {
    expect(isTutorAccount({ relation: 'abuela' })).toBe(false);
    expect(isTutorAccount({ relation: null })).toBe(false);
    expect(isTutorAccount({ relation: '' })).toBe(false);
  });

  it('la regla es exactamente parent y guardian', () => {
    expect([...TUTOR_RELATIONS].sort()).toEqual(['guardian', 'parent']);
  });
});

/**
 * La trampa que separa las dos reglas: el marcador «Sin app» cuenta TODAS las
 * filas, la del propio menor incluida. Si `hasLinkedFamily` filtrara como la
 * lista de Familia, un menor con cuenta propia y sin tutores saldría «Sin app»
 * teniendo la app instalada.
 */
describe('hasLinkedFamily NO es isTutorAccount', () => {
  it('un menor con solo su cuenta propia tiene app, aunque no salga en Familia', () => {
    const soloSelf = [{ profile_id: 'menor', relation: 'self' }];
    expect(hasLinkedFamily(soloSelf)).toBe(true);
    expect(soloSelf.filter(isTutorAccount)).toEqual([]);
  });
});
