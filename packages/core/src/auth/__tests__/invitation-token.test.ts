import { describe, it, expect } from 'vitest';
import {
  assertInvitationValid,
  chooseInviteForm,
  isInvitePending,
} from '../invitation-token';

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

describe('chooseInviteForm (B2b)', () => {
  it('invitee NUEVO con sesión del magic link (sesión = invited_user_id) → set_password', () => {
    expect(
      chooseInviteForm({
        invitedUserId: 'u1',
        sessionUserId: 'u1',
        sessionEmailMatches: true,
        invitePending: false,
      })
    ).toBe('set_password');
  });

  it('invitee NUEVO con sesión e invite_pending activo → set_password', () => {
    expect(
      chooseInviteForm({
        invitedUserId: 'u1',
        sessionUserId: 'u1',
        sessionEmailMatches: true,
        invitePending: true,
      })
    ).toBe('set_password');
  });

  it('invite_pending activo aunque la sesión no sea el invited_user_id → set_password', () => {
    expect(
      chooseInviteForm({
        invitedUserId: 'u1',
        sessionUserId: 'other',
        sessionEmailMatches: true,
        invitePending: true,
      })
    ).toBe('set_password');
  });

  it('CINTURÓN: cuenta no reclamada (invite_pending) con sesión pero SIN invited_user_id → set_password', () => {
    // Reproduce el incidente: el enlazado de invited_user_id falló en el envío, pero
    // el invitado tiene sesión del magic link (invite_pending) con su email → debe poder
    // fijar contraseña sobre su sesión, NO quedar atrapado en 'sign_in'.
    expect(
      chooseInviteForm({
        invitedUserId: null,
        sessionUserId: 'magic-link-user',
        sessionEmailMatches: true,
        invitePending: true,
      })
    ).toBe('set_password');
  });

  it('SEGURIDAD: el cinturón exige email coincidente — invite_pending con email que NO coincide → sign_in', () => {
    // Sesión invite_pending pero de OTRO email (no es este invitado): NO debe fijar
    // contraseña por el token. Sin invited_user_id → sign_in.
    expect(
      chooseInviteForm({
        invitedUserId: null,
        sessionUserId: 'someone-else',
        sessionEmailMatches: false,
        invitePending: true,
      })
    ).toBe('sign_in');
  });

  it('usuario YA configurado (otra cuenta, con contraseña) aceptando invitación adicional → quick', () => {
    expect(
      chooseInviteForm({
        invitedUserId: null,
        sessionUserId: 'existing',
        sessionEmailMatches: true,
        invitePending: false,
      })
    ).toBe('quick');
  });

  it('invitee NUEVO sin sesión (invited_user_id presente) → set_password', () => {
    expect(
      chooseInviteForm({
        invitedUserId: 'u1',
        sessionUserId: null,
        sessionEmailMatches: false,
        invitePending: false,
      })
    ).toBe('set_password');
  });

  it('email preexistente sin sesión (sin invited_user_id) → sign_in', () => {
    expect(
      chooseInviteForm({
        invitedUserId: null,
        sessionUserId: null,
        sessionEmailMatches: false,
        invitePending: false,
      })
    ).toBe('sign_in');
  });
});

describe('isInvitePending (cableado del cinturón #535)', () => {
  it('flag en user_metadata → true (bucket correcto)', () => {
    // Forma REAL del User invitado en prod: invite_pending en user_metadata,
    // app_metadata sin el flag. Con la lectura vieja (app_metadata) esto daba
    // false y el cinturón quedaba inerte: este caso lo habría cazado.
    expect(
      isInvitePending({
        // @ts-expect-error forma parcial suficiente para el gate
        app_metadata: {},
        user_metadata: { invite_pending: true },
      })
    ).toBe(true);
  });

  it('flag SOLO en app_metadata → false (ya NO se lee ese bucket)', () => {
    expect(
      isInvitePending({
        // @ts-expect-error forma parcial suficiente para el gate
        app_metadata: { invite_pending: true },
        user_metadata: {},
      })
    ).toBe(false);
  });

  it('user_metadata.invite_pending=false (cuenta ya reclamada) → false', () => {
    expect(isInvitePending({ user_metadata: { invite_pending: false } })).toBe(false);
  });

  it('sin sesión (null/undefined) → false', () => {
    expect(isInvitePending(null)).toBe(false);
    expect(isInvitePending(undefined)).toBe(false);
  });
});
