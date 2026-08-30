import { describe, expect, it } from 'vitest';
import {
  deriveFamilyLinkStatus,
  hasLinkedFamily,
  hasPendingInvite,
} from '../family-link';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const FUTURE = '2026-09-06T12:00:00.000Z';
const PAST = '2026-08-01T12:00:00.000Z';

describe('hasLinkedFamily', () => {
  it('true con al menos una cuenta, false sin cuentas', () => {
    expect(hasLinkedFamily([{ profile_id: 'a' }])).toBe(true);
    expect(hasLinkedFamily([])).toBe(false);
    expect(hasLinkedFamily(null)).toBe(false);
    expect(hasLinkedFamily(undefined)).toBe(false);
  });
});

describe('hasPendingInvite', () => {
  it('vigente = sin aceptar y sin expirar', () => {
    expect(hasPendingInvite([{ accepted_at: null, expires_at: FUTURE }], NOW)).toBe(true);
  });
  it('aceptada no cuenta', () => {
    expect(
      hasPendingInvite([{ accepted_at: '2026-08-20T00:00:00Z', expires_at: FUTURE }], NOW),
    ).toBe(false);
  });
  it('expirada no cuenta', () => {
    expect(hasPendingInvite([{ accepted_at: null, expires_at: PAST }], NOW)).toBe(false);
  });
  it('lista vacía o nula → false', () => {
    expect(hasPendingInvite([], NOW)).toBe(false);
    expect(hasPendingInvite(null, NOW)).toBe(false);
  });
});

describe('deriveFamilyLinkStatus', () => {
  it('con cuenta → linked (aunque haya invitación)', () => {
    expect(
      deriveFamilyLinkStatus({
        accounts: [{ profile_id: 'a' }],
        invites: [{ accepted_at: null, expires_at: FUTURE }],
        now: NOW,
      }),
    ).toBe('linked');
  });
  it('sin cuenta pero con invitación vigente → invited', () => {
    expect(
      deriveFamilyLinkStatus({
        accounts: [],
        invites: [{ accepted_at: null, expires_at: FUTURE }],
        now: NOW,
      }),
    ).toBe('invited');
  });
  it('sin cuenta y sin invitación vigente → uninvited', () => {
    expect(deriveFamilyLinkStatus({ accounts: [], invites: [], now: NOW })).toBe('uninvited');
    expect(
      deriveFamilyLinkStatus({
        accounts: null,
        invites: [{ accepted_at: null, expires_at: PAST }],
        now: NOW,
      }),
    ).toBe('uninvited');
  });
});
