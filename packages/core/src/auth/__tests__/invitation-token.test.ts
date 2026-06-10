import { describe, it, expect } from 'vitest';
import { assertInvitationValid } from '../invitation-token';

// Reloj fijo para tests deterministas.
const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const FUTURE = '2026-06-17T12:00:00.000Z';
const PAST = '2026-06-03T12:00:00.000Z';

describe('assertInvitationValid', () => {
  it('token válido (pendiente, no caducado, sin chequeo de email)', () => {
    expect(
      assertInvitationValid(
        { accepted_at: null, expires_at: FUTURE, email: 'coach@club.com' },
        NOW
      )
    ).toBe('valid');
  });

  it('token inexistente → not_found', () => {
    expect(assertInvitationValid(null, NOW)).toBe('not_found');
  });

  it('token ya aceptado → already_accepted (prevalece sobre expiración)', () => {
    expect(
      assertInvitationValid(
        { accepted_at: '2026-06-05T00:00:00.000Z', expires_at: PAST, email: 'a@b.com' },
        NOW
      )
    ).toBe('already_accepted');
  });

  it('token caducado → expired', () => {
    expect(
      assertInvitationValid(
        { accepted_at: null, expires_at: PAST, email: 'a@b.com' },
        NOW
      )
    ).toBe('expired');
  });

  it('expires_at no parseable → expired (no se trata como válido)', () => {
    expect(
      assertInvitationValid(
        { accepted_at: null, expires_at: 'not-a-date', email: 'a@b.com' },
        NOW
      )
    ).toBe('expired');
  });

  it('email autenticado no coincide → wrong_email', () => {
    expect(
      assertInvitationValid(
        { accepted_at: null, expires_at: FUTURE, email: 'invited@club.com' },
        NOW,
        'otro@club.com'
      )
    ).toBe('wrong_email');
  });

  it('email coincide (case/space-insensitive) → valid', () => {
    expect(
      assertInvitationValid(
        { accepted_at: null, expires_at: FUTURE, email: 'Invited@Club.com' },
        NOW,
        '  invited@club.com '
      )
    ).toBe('valid');
  });

  it('authedEmail null/undefined omite el chequeo de email', () => {
    const row = { accepted_at: null, expires_at: FUTURE, email: 'x@y.com' };
    expect(assertInvitationValid(row, NOW, null)).toBe('valid');
    expect(assertInvitationValid(row, NOW, undefined)).toBe('valid');
  });
});
