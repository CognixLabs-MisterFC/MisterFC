import { describe, expect, it } from 'vitest';
import {
  extractBearerToken,
  bearerAuthOptions,
} from '../supabase/client-bearer';

describe('F1 · extractBearerToken', () => {
  it('extrae el token de un header Bearer bien formado', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi'); // case-insensitive
    expect(extractBearerToken('  Bearer   tok123  ')).toBe('tok123'); // trim
  });

  it('devuelve null si falta o está mal formado', () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('abc.def.ghi')).toBeNull(); // sin prefijo Bearer
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull(); // otro esquema
    expect(extractBearerToken('Bearer')).toBeNull(); // sin token
    expect(extractBearerToken('Bearer    ')).toBeNull(); // solo espacios
  });
});

describe('F1 · bearerAuthOptions (RLS-scoped, NO admin)', () => {
  it('pone el JWT en el header Authorization y no persiste sesión', () => {
    const opts = bearerAuthOptions('tok123');
    expect(opts.global.headers.Authorization).toBe('Bearer tok123');
    expect(opts.auth.persistSession).toBe(false);
    expect(opts.auth.autoRefreshToken).toBe(false);
  });

  it('NO contiene ninguna service-role key (solo el JWT del usuario)', () => {
    const serialized = JSON.stringify(bearerAuthOptions('user-jwt-token'));
    // El único secreto presente es el JWT del propio usuario, en el header.
    expect(serialized).toContain('Bearer user-jwt-token');
    expect(serialized.toLowerCase()).not.toContain('service_role');
    expect(serialized.toLowerCase()).not.toContain('servicerole');
  });
});
