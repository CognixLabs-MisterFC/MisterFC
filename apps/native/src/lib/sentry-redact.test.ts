import { describe, expect, it } from 'vitest';

import {
  redact,
  sanitizeBreadcrumb,
  sanitizeEvent,
  stripQuery,
  type SanitizableEvent,
} from './sentry-redact';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiTHVjaWEifQ.s5H3xg7yQe2r_1a-Bc';

describe('redact', () => {
  it('redacta un JWT en medio de una frase', () => {
    const out = redact(`fallo al validar el token ${JWT} en el arranque`);
    expect(out).toBe('fallo al validar el token [redacted-token] en el arranque');
    expect(out).not.toContain('eyJ');
  });

  it('corta el query de una URL embebida en texto libre', () => {
    const out = redact('GET https://x.supabase.co/storage/foto.jpg?token=abc123&exp=99 falló');
    expect(out).toBe('GET https://x.supabase.co/storage/foto.jpg falló');
    expect(out).not.toContain('token=');
  });

  it('redacta también un token dentro del query de una URL embebida', () => {
    const out = redact(`descarga https://api.misterfc.com/f?jwt=${JWT} 404`);
    expect(out).toBe('descarga https://api.misterfc.com/f 404');
    expect(out).not.toContain('eyJ');
  });

  it('deja intacto un string sin nada que redactar', () => {
    const clean = 'TypeError: cannot read property length of undefined';
    expect(redact(clean)).toBe(clean);
  });

  it('deja intacta una URL sin query', () => {
    expect(redact('abre https://misterfc.com/equipo ok')).toBe('abre https://misterfc.com/equipo ok');
  });
});

describe('stripQuery', () => {
  it('corta el query de una URL completa', () => {
    expect(stripQuery('https://x.supabase.co/o/foto.jpg?token=abc')).toBe(
      'https://x.supabase.co/o/foto.jpg',
    );
  });

  it('deja una URL sin query igual', () => {
    expect(stripQuery('https://misterfc.com/a')).toBe('https://misterfc.com/a');
  });

  it('devuelve valores no-string tal cual (no peta)', () => {
    expect(stripQuery(undefined)).toBeUndefined();
    expect(stripQuery(42)).toBe(42);
  });
});

describe('sanitizeEvent', () => {
  it('borra el usuario entero y redacta message + logentry', () => {
    const event: SanitizableEvent = {
      user: { id: 'u1', email: 'padre@ejemplo.com' },
      message: `error con ${JWT}`,
      logentry: { message: 'GET https://x.co/f?token=zzz', params: [] },
    };
    const out = sanitizeEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.message).toBe('error con [redacted-token]');
    expect(out.logentry?.message).toBe('GET https://x.co/f');
    // Muta en sitio (mismo referente).
    expect(out).toBe(event);
  });

  it('limpia request: cookies, cabeceras de auth y query de la url', () => {
    const event: SanitizableEvent = {
      request: {
        url: 'https://api.misterfc.com/me?token=secret',
        cookies: 'sb-access-token=zzz',
        headers: { Authorization: `Bearer ${JWT}`, 'X-Trace': 'keep' },
      },
    };
    const out = sanitizeEvent(event);
    expect(out.request?.url).toBe('https://api.misterfc.com/me');
    expect(out.request?.cookies).toBeUndefined();
    const h = out.request?.headers as Record<string, unknown>;
    expect(h.Authorization).toBeUndefined();
    expect(h['X-Trace']).toBe('keep');
  });

  it('redacta cada value de varias exception.values', () => {
    const event: SanitizableEvent = {
      exception: {
        values: [
          { value: `Invalid date parsing ${JWT}` },
          { value: 'fetch https://x.co/g?sig=abc def' },
          { value: 'plain error' },
        ],
      },
    };
    const out = sanitizeEvent(event);
    const vals = out.exception?.values ?? [];
    expect(vals[0]?.value).toBe('Invalid date parsing [redacted-token]');
    expect(vals[1]?.value).toBe('fetch https://x.co/g def');
    expect(vals[2]?.value).toBe('plain error');
  });

  it('no peta con un event sin request ni user', () => {
    const event: SanitizableEvent = { message: 'boot ok' };
    expect(() => sanitizeEvent(event)).not.toThrow();
    const out = sanitizeEvent({});
    expect(out).toEqual({});
  });
});

describe('sanitizeBreadcrumb', () => {
  it('quita query y auth de breadcrumbs de red', () => {
    const bc = sanitizeBreadcrumb({
      category: 'http',
      data: { url: 'https://x.co/f?token=abc', Authorization: `Bearer ${JWT}` },
    });
    const data = bc.data as Record<string, unknown>;
    expect(data.url).toBe('https://x.co/f');
    expect(data.Authorization).toBeUndefined();
  });

  it('redacta tokens en el mensaje del breadcrumb', () => {
    const bc = sanitizeBreadcrumb({ category: 'console', message: `log ${JWT}` });
    expect(bc.message).toBe('log [redacted-token]');
  });
});
