/**
 * R-5 · N-2 — el mapeo del preflight.
 *
 * Lo que se fija aquí es lo que la pantalla NO puede defender por sí sola: que un
 * veredicto que no sea un «sí» explícito no acabe enseñando el formulario del menor a un
 * tutor, y que la RUTA sea la que es — un camino mal escrito devuelve el 404 de Next y
 * se leería como «esta invitación no existe», que es un mensaje falso y muy creíble.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mapPreflightResponse,
  fetchInvitePreflight,
  preflightSePuedeReintentar,
  preflightMandaAlNavegador,
} from './preflight';

const RUTA = '/api/invitations/self-accept/preflight';

function respuesta(status: number, body: unknown, retryAfter?: string): Response {
  return {
    status,
    headers: { get: (h: string) => (h === 'Retry-After' ? (retryAfter ?? null) : null) },
    json: async () => body,
  } as unknown as Response;
}

describe('mapPreflightResponse · el si', () => {
  it('200 diciendo self: el formulario de esta pantalla sirve', () => {
    expect(mapPreflightResponse(200, { status: 'self' }, null)).toEqual({ ok: true });
  });
});

describe('mapPreflightResponse · un 200 que no dice self NO es un si', () => {
  it.each([
    ['sin campo', {}],
    ['con otro tipo', { status: 'tutor' }],
    ['con basura', { status: 42 }],
    ['sin cuerpo', null],
  ])('%s: se trata como not_self, no como ok', (_n, body) => {
    expect(mapPreflightResponse(200, body as never, null)).toEqual({ error: 'not_self' });
  });
});

describe('mapPreflightResponse · los veredictos del token', () => {
  it.each([
    [404, 'not_found'],
    [409, 'not_self'],
    [409, 'expired'],
    [409, 'already_accepted'],
    [409, 'not_claimable'],
    [400, 'invalid'],
    [503, 'unavailable'],
  ])('%s %s se arrastra tal cual', (status, code) => {
    expect(mapPreflightResponse(status as number, { error: code }, null)).toEqual({
      error: code,
    });
  });

  it('un error sin codigo reconocible no se inventa: generic', () => {
    expect(mapPreflightResponse(500, {}, null)).toEqual({ error: 'generic' });
    expect(mapPreflightResponse(500, null, null)).toEqual({ error: 'generic' });
    expect(mapPreflightResponse(500, { error: 7 } as never, null)).toEqual({
      error: 'generic',
    });
  });
});

describe('mapPreflightResponse · el 429 y su cuando', () => {
  it('trae los segundos del servidor', () => {
    expect(mapPreflightResponse(429, { error: 'rate_limited' }, '90')).toEqual({
      error: 'rate_limited',
      retryAfter: 90,
    });
  });

  it('sin cabecera NO se inventa un minuto por defecto', () => {
    expect(mapPreflightResponse(429, { error: 'rate_limited' }, null)).toEqual({
      error: 'rate_limited',
    });
  });

  it.each([['cabecera ilegible', 'luego'], ['cero', '0'], ['negativa', '-5']])(
    '%s: rate_limited sin cifra',
    (_n, cab) => {
      expect(mapPreflightResponse(429, { error: 'rate_limited' }, cab)).toEqual({
        error: 'rate_limited',
      });
    },
  );

  it('redondea hacia arriba: 30,2 s son 31', () => {
    expect(mapPreflightResponse(429, {}, '30.2')).toEqual({
      error: 'rate_limited',
      retryAfter: 31,
    });
  });
});

describe('fetchInvitePreflight · la fontaneria', () => {
  it('llama a la RUTA del preflight, con el token en el cuerpo', async () => {
    const call = vi.fn(async () => respuesta(200, { status: 'self' }));
    const out = await fetchInvitePreflight(call, 'tok-1');
    expect(call).toHaveBeenCalledWith(RUTA, { token: 'tok-1' });
    expect(out).toEqual({ ok: true });
  });

  it('sin EXPO_PUBLIC_WEB_URL el codigo es no_web_url, no "sin conexion"', async () => {
    const call = vi.fn(async () => {
      throw new Error('no_web_url');
    });
    expect(await fetchInvitePreflight(call, 'tok-1')).toEqual({ error: 'no_web_url' });
  });

  it('cualquier otro fallo de red es network', async () => {
    const call = vi.fn(async () => {
      throw new Error('Network request failed');
    });
    expect(await fetchInvitePreflight(call, 'tok-1')).toEqual({ error: 'network' });
  });

  it('un cuerpo que no es JSON no revienta: se mapea por el estado', async () => {
    const roto = {
      status: 409,
      headers: { get: () => null },
      json: async () => {
        throw new Error('Unexpected token <');
      },
    } as unknown as Response;
    expect(await fetchInvitePreflight(async () => roto, 'tok-1')).toEqual({
      error: 'generic',
    });
  });
});

describe('que hacer con cada veredicto', () => {
  it('solo rate_limited y network se pueden reintentar', () => {
    expect(preflightSePuedeReintentar('rate_limited')).toBe(true);
    expect(preflightSePuedeReintentar('network')).toBe(true);
    for (const code of ['not_self', 'not_found', 'expired', 'already_accepted', 'not_claimable', 'no_web_url', 'generic']) {
      expect(preflightSePuedeReintentar(code)).toBe(false);
    }
  });

  it('solo not_self manda al navegador: los demas fallarian igual alli', () => {
    expect(preflightMandaAlNavegador('not_self')).toBe(true);
    for (const code of ['not_found', 'expired', 'already_accepted', 'not_claimable', 'rate_limited', 'network']) {
      expect(preflightMandaAlNavegador(code)).toBe(false);
    }
  });
});
