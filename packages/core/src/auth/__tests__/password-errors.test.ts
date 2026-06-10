import { describe, it, expect } from 'vitest';
import { isSamePasswordError } from '../password-errors';

describe('isSamePasswordError', () => {
  it('detecta el code same_password (contrato GoTrue)', () => {
    expect(isSamePasswordError({ code: 'same_password', message: 'whatever' })).toBe(true);
  });

  it('detecta el message "should be different from the old password"', () => {
    expect(
      isSamePasswordError({
        message: 'New password should be different from the old password.',
      })
    ).toBe(true);
  });

  it('detecta variantes de message (case-insensitive)', () => {
    expect(isSamePasswordError({ message: 'SAME AS THE OLD PASSWORD' })).toBe(true);
    expect(isSamePasswordError({ message: 'must be different from the old password' })).toBe(true);
  });

  it('NO marca otros errores de auth como same-password', () => {
    expect(isSamePasswordError({ code: 'weak_password', message: 'Password is too weak' })).toBe(false);
    expect(isSamePasswordError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isSamePasswordError({ message: 'network error' })).toBe(false);
  });

  it('robusto ante null/undefined/no-objeto', () => {
    expect(isSamePasswordError(null)).toBe(false);
    expect(isSamePasswordError(undefined)).toBe(false);
    expect(isSamePasswordError('same_password')).toBe(false);
    expect(isSamePasswordError({})).toBe(false);
  });
});
