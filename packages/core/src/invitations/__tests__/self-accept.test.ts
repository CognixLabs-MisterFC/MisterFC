/**
 * R-2 — el gate del endpoint público sin sesión.
 *
 * Estas pruebas existen por una razón concreta: `apps/web` no tiene ninguna, así que si
 * el invariante no se defiende aquí no se defiende en ningún sitio. Lo que se fija es
 * que el endpoint atienda EXCLUSIVAMENTE el caso `set_password` de una invitación
 * `self` — y, sobre todo, que NO atienda la rama `sign_in`, que lo convertiría en un
 * oráculo de contraseñas sin autenticar.
 */

import { describe, it, expect } from 'vitest';
import { decideSelfAccept } from '../self-accept';

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const MANANA = new Date(NOW + 24 * 3600 * 1000).toISOString();
const AYER = new Date(NOW - 24 * 3600 * 1000).toISOString();

function invitacion(over: Partial<NonNullable<Parameters<typeof decideSelfAccept>[0]>> = {}) {
  return {
    accepted_at: null,
    expires_at: MANANA,
    email: 'menor@test.test',
    player_relation: 'self',
    invited_user_id: 'uid-menor',
    ...over,
  };
}

describe('decideSelfAccept · el caso que sí', () => {
  it('invitacion self viva y sin reclamar: pasa, y devuelve a quien reclamar', () => {
    const d = decideSelfAccept(invitacion(), NOW);
    expect(d).toEqual({ ok: { targetUid: 'uid-menor', email: 'menor@test.test' } });
  });

  it('el email sale de la INVITACION, no de quien llama', () => {
    const d = decideSelfAccept(invitacion({ email: 'otro@test.test' }), NOW);
    expect(d).toEqual({ ok: { targetUid: 'uid-menor', email: 'otro@test.test' } });
  });
});

describe('decideSelfAccept · el invariante', () => {
  it('SIN invited_user_id NO entra: esa es la rama sign_in', () => {
    const d = decideSelfAccept(invitacion({ invited_user_id: null }), NOW);
    expect(d).toEqual({ error: 'not_claimable' });
  });

  it('una invitacion de TUTOR no entra aunque este viva y reclamable', () => {
    const d = decideSelfAccept(invitacion({ player_relation: 'parent' }), NOW);
    expect(d).toEqual({ error: 'not_self' });
  });

  it('sin relacion tampoco entra: solo self, no "cualquier cosa que no sea tutor"', () => {
    const d = decideSelfAccept(invitacion({ player_relation: null }), NOW);
    expect(d).toEqual({ error: 'not_self' });
  });

  it('el estado del token manda SOBRE la relacion: una self ya aceptada no se cuela', () => {
    const d = decideSelfAccept(
      invitacion({ accepted_at: '2026-09-01T00:00:00.000Z' }),
      NOW,
    );
    expect(d).toEqual({ error: 'already_accepted' });
  });
});

describe('decideSelfAccept · el estado del token', () => {
  it('token que no existe', () => {
    expect(decideSelfAccept(null, NOW)).toEqual({ error: 'not_found' });
  });

  it('caducada', () => {
    expect(decideSelfAccept(invitacion({ expires_at: AYER }), NOW)).toEqual({
      error: 'expired',
    });
  });

  it('ya aceptada', () => {
    expect(
      decideSelfAccept(invitacion({ accepted_at: '2026-09-01T00:00:00.000Z' }), NOW),
    ).toEqual({ error: 'already_accepted' });
  });

  it('caducidad ilegible cuenta como caducada, no como valida', () => {
    expect(decideSelfAccept(invitacion({ expires_at: 'no-es-fecha' }), NOW)).toEqual({
      error: 'expired',
    });
  });

  it('el limite es el instante exacto: un milisegundo antes sigue viva', () => {
    const justo = new Date(NOW + 1).toISOString();
    expect(decideSelfAccept(invitacion({ expires_at: justo }), NOW)).toHaveProperty('ok');
  });
});
