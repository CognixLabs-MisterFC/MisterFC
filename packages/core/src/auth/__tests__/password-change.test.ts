import { describe, it, expect } from 'vitest';
import { requiresPasswordChange, authMethodsFrom } from '../password-change';

/**
 * El candado: quien llega por el enlace de recuperación no sigue hasta fijar
 * contraseña.
 *
 * Los dos `amr` de referencia están MEDIDOS contra GoTrue de producción, no
 * inventados: `[{method:'otp'}]` es lo que trae una sesión recién llegada del
 * enlace, y `[{method:'password'}]` lo que trae quien entra tecleando.
 *
 * Lo que más se vigila aquí es el lado de NO cerrarlo: equivocarse cerrando deja
 * a alguien dando vueltas sin salida, y equivocarse abriendo solo significa que
 * sigue con su contraseña vieja un rato más.
 */

const DEL_ENLACE = [{ method: 'otp', timestamp: 1790012589 }];
const CON_CONTRASENA = [{ method: 'password', timestamp: 1790012570 }];

describe('requiresPasswordChange · los dos casos reales', () => {
  it('la sesion del enlace de recuperacion SI tiene que cambiarla', () => {
    expect(requiresPasswordChange(DEL_ENLACE)).toBe(true);
  });

  it('la sesion de quien entro con su contrasena NO', () => {
    expect(requiresPasswordChange(CON_CONTRASENA)).toBe(false);
  });
});

describe('requiresPasswordChange · hacen falta LAS DOS condiciones', () => {
  it('con contrasena ademas del otp, el candado esta abierto', () => {
    // Si bastara «otp presente», una sesion autenticada por los dos caminos
    // quedaria encerrada. Hoy no ocurre —volver a autenticar crea sesion nueva—
    // pero la regla no depende de que siga siendo asi.
    expect(
      requiresPasswordChange([{ method: 'otp' }, { method: 'password' }]),
    ).toBe(false);
  });

  it('un metodo que no es ninguno de los dos NO cierra el candado', () => {
    // Si bastara «sin password», un OAuth futuro caeria aqui y forzarle una
    // contraseña seria un disparate.
    expect(requiresPasswordChange([{ method: 'oauth' }])).toBe(false);
    expect(requiresPasswordChange([{ method: 'sso/saml' }])).toBe(false);
    expect(requiresPasswordChange([{ method: 'anonymous' }])).toBe(false);
  });
});

describe('requiresPasswordChange · un token raro NO encierra a nadie', () => {
  it('sin amr, o con un amr que no es lista', () => {
    for (const raro of [undefined, null, '', 'otp', 42, {}, { method: 'otp' }]) {
      expect(requiresPasswordChange(raro)).toBe(false);
    }
  });

  it('una lista vacia tampoco', () => {
    expect(requiresPasswordChange([])).toBe(false);
  });

  it('elementos basura se ignoran, pero el otp de al lado cuenta', () => {
    expect(requiresPasswordChange([null, 'otp', 7, { method: 'otp' }])).toBe(true);
    expect(requiresPasswordChange([null, 7, {}, { method: null }])).toBe(false);
  });

  it('el metodo tiene que ser exactamente `otp`', () => {
    // Nada de coincidencias parciales: `otp_something` no es lo que medimos.
    expect(requiresPasswordChange([{ method: 'recovery' }])).toBe(false);
    expect(requiresPasswordChange([{ method: 'OTP' }])).toBe(false);
    expect(requiresPasswordChange([{ method: 'otp_magic' }])).toBe(false);
  });
});

describe('authMethodsFrom', () => {
  it('saca los metodos y descarta lo que no sea texto', () => {
    expect(authMethodsFrom([{ method: 'otp' }, { method: '' }, { method: 3 }, null])).toEqual([
      'otp',
    ]);
  });

  it('lo que no es lista da lista vacia', () => {
    expect(authMethodsFrom(undefined)).toEqual([]);
    expect(authMethodsFrom({ method: 'otp' })).toEqual([]);
  });
});
