import { describe, expect, it } from 'vitest';
import { consentSections, revokeEffectKey, type ConsentRowInput } from './rows';

const RETIRABLES = ['image_internal', 'image_social', 'medical_data_processing'];

const fila = (o: Partial<ConsentRowInput> = {}): ConsentRowInput => ({
  playerId: 'p1',
  playerName: 'Ana',
  consentType: 'image_internal',
  granted: true,
  acceptedAt: '2026-09-01T10:00:00Z',
  legalDocumentId: 'doc',
  title: 'Imagen interna',
  ...o,
});

describe('consentSections', () => {
  it('la cuenta va primero y luego un grupo por hijo', () => {
    const s = consentSections(
      [
        fila({ playerId: 'p2', playerName: 'Berta' }),
        fila({ playerId: null, playerName: null, consentType: 'privacy_policy' }),
        fila({ playerId: 'p1', playerName: 'Ana' }),
      ],
      { revocableTypes: RETIRABLES },
    );
    expect(s.map((x) => x.playerId)).toEqual([null, 'p1', 'p2']);
    expect(s[1].playerName).toBe('Ana');
    expect(s[2].playerName).toBe('Berta');
  });

  it('sin filas de cuenta no se inventa la sección', () => {
    const s = consentSections([fila()], { revocableTypes: RETIRABLES });
    expect(s).toHaveLength(1);
    expect(s[0].playerId).toBe('p1');
  });

  it('dentro del grupo manda el orden fijo, no el título', () => {
    const s = consentSections(
      [
        fila({ consentType: 'medical_data_processing', title: 'AAA' }),
        fila({ consentType: 'image_social', title: 'BBB' }),
        fila({ consentType: 'image_internal', title: 'ZZZ' }),
      ],
      { revocableTypes: RETIRABLES },
    );
    expect(s[0].rows.map((r) => r.consentType)).toEqual([
      'image_internal',
      'image_social',
      'medical_data_processing',
    ]);
  });

  // Un tipo que nadie haya dado de alta en el orden debe verse que sobra, no colarse.
  it('un tipo desconocido cae AL FINAL', () => {
    const s = consentSections(
      [fila({ consentType: 'inventado' }), fila({ consentType: 'image_internal' })],
      { revocableTypes: RETIRABLES },
    );
    expect(s[0].rows.map((r) => r.consentType)).toEqual(['image_internal', 'inventado']);
  });

  it('el botón solo aparece si está concedido Y es retirable', () => {
    const s = consentSections(
      [
        fila({ consentType: 'image_internal', granted: true }),
        fila({ consentType: 'image_social', granted: false }),
        fila({ consentType: 'privacy_policy', granted: true }),
      ],
      { revocableTypes: RETIRABLES },
    );
    const porTipo = Object.fromEntries(s[0].rows.map((r) => [r.consentType, r.canRevoke]));
    expect(porTipo).toEqual({
      image_internal: true,
      image_social: false,
      privacy_policy: false,
    });
  });

  // Si la lista de retirables llegara vacía (core cambiado, import roto), la pantalla
  // se queda SIN botones en vez de ofrecerlos todos. Falla hacia el lado seguro.
  it('sin tipos retirables no se pinta ningún botón', () => {
    const s = consentSections([fila()], { revocableTypes: [] });
    expect(s[0].rows[0].canRevoke).toBe(false);
  });

  it('dos hijos con el mismo nombre no bailan entre renders', () => {
    const entrada = [
      fila({ playerId: 'p2', playerName: 'Ana' }),
      fila({ playerId: 'p1', playerName: 'Ana' }),
    ];
    const a = consentSections(entrada, { revocableTypes: RETIRABLES });
    const b = consentSections([...entrada].reverse(), { revocableTypes: RETIRABLES });
    expect(a.map((x) => x.playerId)).toEqual(['p1', 'p2']);
    expect(b.map((x) => x.playerId)).toEqual(['p1', 'p2']);
  });

  it('un hijo sin nombre no rompe el orden', () => {
    const s = consentSections(
      [fila({ playerId: 'p2', playerName: null }), fila({ playerId: 'p1', playerName: 'Ana' })],
      { revocableTypes: RETIRABLES },
    );
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.playerName)).toEqual([null, 'Ana']);
  });

  it('lista vacía es lista vacía', () => {
    expect(consentSections([], { revocableTypes: RETIRABLES })).toEqual([]);
  });
});

describe('revokeEffectKey', () => {
  it.each([
    ['image_internal', 'revoke_effect.image_internal'],
    ['image_social', 'revoke_effect.image_social'],
    ['medical_data_processing', 'revoke_effect.medical'],
  ])('%s tiene su propio aviso', (tipo, clave) => {
    expect(revokeEffectKey(tipo)).toBe(clave);
  });

  // Preferimos no decir nada a decir algo falso sobre el dato de un menor.
  it('un tipo sin aviso propio devuelve null, no el del vecino', () => {
    expect(revokeEffectKey('terms_conditions')).toBeNull();
    expect(revokeEffectKey('inventado')).toBeNull();
  });
});
