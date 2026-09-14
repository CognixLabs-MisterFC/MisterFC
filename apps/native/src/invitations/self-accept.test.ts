import { describe, it, expect, vi } from 'vitest';
import { mapSelfAcceptResponse, selfAcceptMessageKey, submitSelfAccept } from '@/invitations/self-accept';

/**
 * R-3 — el mapeo de la respuesta del endpoint.
 *
 * El import va por el ALIAS `@` a propósito, y no por ruta relativa: hasta aquí ningún
 * test lo usaba, y estaba roto para cualquier checkout cuya ruta lleve un espacio (el
 * `.pathname` de la config venía percent-encoded). Importando así, el arreglo queda
 * cubierto: si alguien lo deshace, esto se pone rojo en vez de seguir latente.
 *
 * Existe porque la pantalla no se puede probar en este repo (vitest de nativa corre
 * lógica pura en Node, sin runtime de RN), así que todo lo que decide QUÉ ve el usuario
 * tiene que estar fuera del componente para poder ponerse rojo.
 */

describe('mapSelfAcceptResponse · el caso bueno', () => {
  it('200 con tokens abre sesion', () => {
    const r = mapSelfAcceptResponse(
      200,
      { access_token: 'at', refresh_token: 'rt' },
      null,
    );
    expect(r).toEqual({ ok: { accessToken: 'at', refreshToken: 'rt' } });
  });

  it('200 SIN tokens NO es exito: sin ellos no hay sesion que abrir', () => {
    expect(mapSelfAcceptResponse(200, { access_token: 'at' }, null)).toEqual({
      error: 'no_session',
    });
    expect(mapSelfAcceptResponse(200, null, null)).toEqual({ error: 'no_session' });
  });
});

describe('mapSelfAcceptResponse · el 429', () => {
  it('lleva los segundos que dice el servidor, no un minuto inventado', () => {
    expect(mapSelfAcceptResponse(429, { error: 'rate_limited' }, '340')).toEqual({
      error: 'rate_limited',
      retryAfter: 340,
    });
  });

  it('sin cabecera utilizable, rate_limited SIN cifra: mejor no decir cuando que mentir', () => {
    expect(mapSelfAcceptResponse(429, { error: 'rate_limited' }, null)).toEqual({
      error: 'rate_limited',
    });
    expect(mapSelfAcceptResponse(429, { error: 'rate_limited' }, 'pronto')).toEqual({
      error: 'rate_limited',
    });
    expect(mapSelfAcceptResponse(429, { error: 'rate_limited' }, '-5')).toEqual({
      error: 'rate_limited',
    });
  });

  it('redondea hacia arriba: decir 3 s cuando faltan 3,2 deja volver demasiado pronto', () => {
    expect(mapSelfAcceptResponse(429, {}, '3.2')).toEqual({
      error: 'rate_limited',
      retryAfter: 4,
    });
  });
});

describe('mapSelfAcceptResponse · los veredictos del token', () => {
  it.each([
    [404, 'not_found'],
    [409, 'expired'],
    [409, 'already_accepted'],
    [409, 'not_self'],
    [409, 'not_claimable'],
    [409, 'wrong_email'],
    [409, 'consent_required'],
    [503, 'unavailable'],
  ])('%i %s sale tal cual, con su nombre', (status, code) => {
    expect(mapSelfAcceptResponse(status, { error: code }, null)).toEqual({ error: code });
  });

  it('un error sin codigo reconocible cae en generic, no en undefined', () => {
    expect(mapSelfAcceptResponse(500, {}, null)).toEqual({ error: 'generic' });
    expect(mapSelfAcceptResponse(500, { error: 42 }, null)).toEqual({ error: 'generic' });
    expect(mapSelfAcceptResponse(500, null, null)).toEqual({ error: 'generic' });
  });
});

describe('selfAcceptMessageKey', () => {
  it('cada veredicto apunta a su clave del namespace invite', () => {
    expect(selfAcceptMessageKey('expired')).toBe('error_expired');
    expect(selfAcceptMessageKey('not_self')).toBe('error_not_self');
    expect(selfAcceptMessageKey('rate_limited')).toBe('error_rate_limited');
  });

  it('los codigos con clave IRREGULAR no acaban pintando el nombre de la clave', () => {
    // El catalogo lo escribio la web y no es homogeneo: estos dos se llaman
    // `missing_*`, no `error_*`. Sin la tabla, la pantalla enseñaba
    // "error_phone_missing" tal cual al usuario.
    expect(selfAcceptMessageKey('phone_missing')).toBe('missing_phone');
    expect(selfAcceptMessageKey('password_missing')).toBe('missing_password');
  });
});

describe('submitSelfAccept · lo que pasa cuando no hay respuesta', () => {
  const body = {
    token: 't',
    full_name: 'N',
    phone: '600',
    date_of_birth: null,
    password: 'p',
    confirm: 'p',
    accept_terms: true,
    accept_privacy: true,
    locale: 'es',
  };

  it('sin dominio configurado dice no_web_url, NO "sin conexion"', async () => {
    const call = vi.fn(() => Promise.reject(new Error('no_web_url')));
    await expect(submitSelfAccept(call, body)).resolves.toEqual({ error: 'no_web_url' });
  });

  it('si el fetch revienta por red, es network', async () => {
    const call = vi.fn(() => Promise.reject(new Error('Network request failed')));
    await expect(submitSelfAccept(call, body)).resolves.toEqual({ error: 'network' });
  });

  it('un cuerpo que no es JSON no tumba el intento: cae al codigo del status', async () => {
    const call = vi.fn(() =>
      Promise.resolve({
        status: 500,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not json')),
      } as unknown as Response),
    );
    await expect(submitSelfAccept(call, body)).resolves.toEqual({ error: 'generic' });
  });

  it('el 200 bueno viaja entero: manda al endpoint la ruta y el cuerpo que toca', async () => {
    const call = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ access_token: 'at', refresh_token: 'rt' }),
      } as unknown as Response),
    );
    await expect(submitSelfAccept(call, body)).resolves.toEqual({
      ok: { accessToken: 'at', refreshToken: 'rt' },
    });
    expect(call).toHaveBeenCalledWith('/api/invitations/self-accept', body);
  });
});
