import { describe, it, expect, vi } from 'vitest';
import {
  mapRecoveryResponse,
  recoveryMessageKey,
  submitPasswordRecovery,
} from '@/auth/password-recovery';

/**
 * Correo-B · el mapeo de la respuesta del endpoint de recuperación.
 *
 * Existe porque la pantalla no se puede probar en este repo (vitest de nativa corre
 * lógica pura en Node, sin runtime de RN), así que todo lo que decide QUÉ ve el
 * usuario tiene que estar fuera del componente para poder ponerse rojo.
 *
 * Lo que de verdad se vigila aquí es que NO SE FILTRE si la cuenta existe: el 200 es
 * el mismo se haya mandado el correo o no, y el mapeo no puede inventarse una
 * diferencia que el servidor se cuida de no dar.
 */

describe('mapRecoveryResponse · el caso bueno', () => {
  it('200 es «pedido», sin decir si habia cuenta', () => {
    expect(mapRecoveryResponse(200, { ok: true }, null)).toEqual({ ok: true });
  });

  it('200 sin cuerpo legible sigue siendo «pedido»', () => {
    // El endpoint contesta {ok:true}, pero si un proxy se comiera el cuerpo el
    // usuario no debe ver un error por algo que SI paso.
    expect(mapRecoveryResponse(200, null, null)).toEqual({ ok: true });
  });
});

describe('mapRecoveryResponse · el limite', () => {
  it('429 con Retry-After trae los segundos del servidor', () => {
    expect(mapRecoveryResponse(429, { error: 'rate_limited' }, '540')).toEqual({
      error: 'rate_limited',
      retryAfter: 540,
    });
  });

  it('429 sin cabecera NO se inventa una espera', () => {
    // Adivinar un minuto por defecto pondria en pantalla una cifra que no casa con
    // la ventana real del contador.
    expect(mapRecoveryResponse(429, { error: 'rate_limited' }, null)).toEqual({
      error: 'rate_limited',
    });
  });

  it('429 con cabecera basura tampoco', () => {
    for (const basura of ['', 'pronto', '-5', '0', 'NaN']) {
      expect(mapRecoveryResponse(429, { error: 'rate_limited' }, basura)).toEqual({
        error: 'rate_limited',
      });
    }
  });

  it('redondea hacia arriba: medio minuto es un minuto de espera', () => {
    expect(mapRecoveryResponse(429, null, '30.2')).toEqual({
      error: 'rate_limited',
      retryAfter: 31,
    });
  });
});

describe('mapRecoveryResponse · los fallos', () => {
  it('propaga el codigo del servidor', () => {
    expect(mapRecoveryResponse(400, { error: 'invalid_email' }, null)).toEqual({
      error: 'invalid_email',
    });
    expect(mapRecoveryResponse(503, { error: 'unavailable' }, null)).toEqual({
      error: 'unavailable',
    });
  });

  it('un error sin codigo reconocible cae en generic', () => {
    expect(mapRecoveryResponse(500, null, null)).toEqual({ error: 'generic' });
    expect(mapRecoveryResponse(502, { error: 42 }, null)).toEqual({ error: 'generic' });
    expect(mapRecoveryResponse(500, { error: '' }, null)).toEqual({ error: 'generic' });
  });
});

describe('submitPasswordRecovery', () => {
  const respuesta = (status: number, body: unknown, retry?: string) =>
    ({
      status,
      json: async () => body,
      headers: { get: (k: string) => (k === 'Retry-After' ? (retry ?? null) : null) },
    }) as unknown as Response;

  it('llama al endpoint con el correo y el idioma', async () => {
    const call = vi.fn().mockResolvedValue(respuesta(200, { ok: true }));
    const out = await submitPasswordRecovery(call, { email: 'ana@club.es', locale: 'va' });

    expect(call).toHaveBeenCalledWith('/api/auth/password-recovery', {
      email: 'ana@club.es',
      locale: 'va',
    });
    expect(out).toEqual({ ok: true });
  });

  it('NO manda el destino del enlace: eso lo decide el servidor', async () => {
    const call = vi.fn().mockResolvedValue(respuesta(200, { ok: true }));
    await submitPasswordRecovery(call, { email: 'ana@club.es', locale: 'es' });

    const cuerpo = call.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(cuerpo).sort()).toEqual(['email', 'locale']);
  });

  it('falta de configuracion web tiene su propio codigo', async () => {
    const call = vi.fn().mockRejectedValue(new Error('no_web_url'));
    expect(await submitPasswordRecovery(call, { email: 'a@b.es', locale: 'es' })).toEqual({
      error: 'no_web_url',
    });
  });

  it('cualquier otro tropiezo del fetch es red', async () => {
    const call = vi.fn().mockRejectedValue(new Error('Network request failed'));
    expect(await submitPasswordRecovery(call, { email: 'a@b.es', locale: 'es' })).toEqual({
      error: 'network',
    });
  });

  it('un cuerpo que no es JSON no revienta el intento', async () => {
    const call = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => {
        throw new Error('no es json');
      },
      headers: { get: () => null },
    } as unknown as Response);

    expect(await submitPasswordRecovery(call, { email: 'a@b.es', locale: 'es' })).toEqual({
      error: 'generic',
    });
  });

  it('el 429 llega a la pantalla con su espera', async () => {
    const call = vi.fn().mockResolvedValue(respuesta(429, { error: 'rate_limited' }, '120'));
    expect(await submitPasswordRecovery(call, { email: 'a@b.es', locale: 'es' })).toEqual({
      error: 'rate_limited',
      retryAfter: 120,
    });
  });
});

describe('recoveryMessageKey', () => {
  it('los codigos con texto propio van a su clave', () => {
    expect(recoveryMessageKey('invalid_email')).toBe('error_invalid_email');
    expect(recoveryMessageKey('rate_limited')).toBe('error_rate_limited');
    expect(recoveryMessageKey('network')).toBe('error_network');
    expect(recoveryMessageKey('no_web_url')).toBe('error_no_web_url');
  });

  it('lo que la app no conoce cae en generic, no en el nombre de la clave', () => {
    // `unavailable` lo contesta el servidor HOY y no tiene texto propio: sin esta
    // regla la pantalla pintaria «error_unavailable» al usuario.
    expect(recoveryMessageKey('unavailable')).toBe('error_generic');
    expect(recoveryMessageKey('lo_que_venga_manana')).toBe('error_generic');
    expect(recoveryMessageKey('')).toBe('error_generic');
  });
});
