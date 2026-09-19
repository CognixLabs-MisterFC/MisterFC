import { describe, it, expect } from 'vitest';
import {
  INVITE_KINDS,
  inviteEmailMetadata,
  type InviteKind,
} from '../invite-email-metadata';

describe('A-1 · metadatos del correo de invitación', () => {
  it('conserva las dos claves que ya leía la página de invitación', () => {
    // invite_pending e invitation_id NO son decorativos: los lee
    // /invite/[token] para decidir si pide contraseña. Si este helper deja de
    // ponerlos, el invitado cae en la trampa.
    const data = inviteEmailMetadata({
      invitationId: 'inv-1',
      kind: 'staff',
      locale: 'es',
    });
    expect(data.invite_pending).toBe(true);
    expect(data.invitation_id).toBe('inv-1');
  });

  it('lleva el tipo y el idioma que la plantilla ramifica', () => {
    const data = inviteEmailMetadata({
      invitationId: 'inv-2',
      kind: 'seguidor',
      locale: 'va',
    });
    expect(data.invite_kind).toBe('seguidor');
    expect(data.invite_locale).toBe('va');
  });

  it('son los cinco destinatarios, ni uno más', () => {
    // La plantilla tiene una rama por cada uno y una neutra de reserva. Si
    // aparece un sexto, hay que añadir su rama ANTES de usarlo: sin ella el
    // correo sale con el texto genérico y nadie se entera.
    expect([...INVITE_KINDS]).toEqual([
      'staff',
      'admin',
      'tutor',
      'seguidor',
      'menor',
    ]);
  });

  it('cada tipo viaja tal cual, sin traducir ni normalizar', () => {
    for (const kind of INVITE_KINDS) {
      const data = inviteEmailMetadata({
        invitationId: 'inv-3',
        kind: kind as InviteKind,
        locale: 'en',
      });
      expect(data.invite_kind).toBe(kind);
    }
  });
});
