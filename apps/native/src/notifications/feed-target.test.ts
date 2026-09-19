import { describe, it, expect } from 'vitest';
import { directionFeedTarget, familyFeedTarget } from '@/notifications/feed-target';

/**
 * Imagen-2 — a dónde lleva el aviso de retirada del permiso de imagen en la app.
 *
 * Lo que se prueba es la asimetría, que es deliberada y fácil de "arreglar" por error:
 * dirección tiene ficha de jugador (`/direction/jugador?playerId`) y va a ella, porque
 * ahí está la foto que hay que quitar; el área de STAFF no tiene ficha (su consulta es
 * la lista del equipo, sin detalle), así que la fila NO navega. Un destino inventado
 * rebotaría en el AreaGuard y dejaría al entrenador en el inicio sin explicación.
 */

const PLAYER = 'b3f2c0d1-0000-4000-8000-000000000001';
const TYPE = 'image_consent_revoked';

describe('dirección', () => {
  it('va a la ficha del jugador, con su playerId', () => {
    expect(directionFeedTarget(TYPE, { player_id: PLAYER, consent_type: 'image_social' })).toEqual({
      pathname: '/direction/jugador',
      params: { playerId: PLAYER },
    });
  });

  it('sin player_id no inventa destino: fila informativa', () => {
    expect(directionFeedTarget(TYPE, { club_id: 'c1' })).toBeNull();
    expect(directionFeedTarget(TYPE, null)).toBeNull();
    expect(directionFeedTarget(TYPE, { player_id: '' })).toBeNull();
  });

  it('da igual cuál de los dos permisos sea: el sitio donde se actúa es el mismo', () => {
    const interna = directionFeedTarget(TYPE, { player_id: PLAYER, consent_type: 'image_internal' });
    const redes = directionFeedTarget(TYPE, { player_id: PLAYER, consent_type: 'image_social' });
    expect(interna).toEqual(redes);
  });
});

describe('familia y staff', () => {
  it('no navega: el área de staff no tiene ficha de jugador', () => {
    expect(familyFeedTarget(TYPE, { player_id: PLAYER, consent_type: 'image_internal' })).toBeNull();
  });
});
