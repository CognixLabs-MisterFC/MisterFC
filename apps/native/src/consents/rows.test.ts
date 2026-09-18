import { describe, expect, it } from 'vitest';
import {
  consentSections,
  consentTypeKey,
  grantEffectKey,
  revokeEffectKey,
  type ConsentOptionInput,
  type ConsentRowInput,
} from './rows';

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

const opcion = (o: Partial<ConsentOptionInput> = {}): ConsentOptionInput => ({
  playerId: 'p1',
  playerName: 'Ana',
  consentType: 'image_internal',
  state: 'granted',
  decidedAt: '2026-09-01T10:00:00Z',
  signedDocumentId: 'doc',
  signedDocumentTitle: 'Imagen interna',
  currentDocumentId: 'doc',
  currentDocumentTitle: 'Imagen interna',
  ...o,
});

const secciones = (
  ledger: ConsentRowInput[],
  options: ConsentOptionInput[],
  revocableTypes = RETIRABLES,
) => consentSections({ ledger, options }, { revocableTypes });

describe('consentSections', () => {
  it('la cuenta va primero y luego un grupo por hijo', () => {
    const s = secciones(
      [fila({ playerId: null, playerName: null, consentType: 'privacy_policy' })],
      [opcion({ playerId: 'p2', playerName: 'Berta' }), opcion({ playerId: 'p1', playerName: 'Ana' })],
    );
    expect(s.map((x) => x.kind)).toEqual(['account', 'child', 'child']);
    expect(s.map((x) => (x.kind === 'account' ? null : x.playerName))).toEqual([
      null,
      'Ana',
      'Berta',
    ]);
  });

  it('sin filas de cuenta no se inventa la sección', () => {
    const s = secciones([], [opcion()]);
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('child');
  });

  // Las filas de HIJO del ledger no pintan sección propia: de ese hijo manda la
  // rejilla, que siempre trae los tres y además sabe qué se puede conceder.
  it('la rejilla manda sobre el ledger para el mismo hijo', () => {
    const s = secciones([fila({ playerId: 'p1' })], [opcion({ playerId: 'p1' })]);
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('child');
  });

  // El ledger no se borra nunca: lo que decidió sobre alguien que ya no gestiona se
  // sigue viendo, sin botones, porque el gate ya dice que no.
  it('un jugador que solo está en el ledger sale como histórico, y al final', () => {
    const s = secciones(
      [
        fila({ playerId: null, playerName: null, consentType: 'terms_conditions' }),
        fila({ playerId: 'pX', playerName: 'Antiguo' }),
      ],
      [opcion({ playerId: 'p1', playerName: 'Ana' })],
    );
    expect(s.map((x) => x.kind)).toEqual(['account', 'child', 'past']);
    const ultima = s[2];
    expect(ultima.kind === 'past' && ultima.playerName).toBe('Antiguo');
  });

  it('dentro del grupo manda el orden fijo, no el título', () => {
    const s = secciones(
      [],
      [
        opcion({ consentType: 'medical_data_processing', signedDocumentTitle: 'AAA' }),
        opcion({ consentType: 'image_social', signedDocumentTitle: 'BBB' }),
        opcion({ consentType: 'image_internal', signedDocumentTitle: 'ZZZ' }),
      ],
    );
    expect(s[0].kind === 'child' && s[0].rows.map((r) => r.consentType)).toEqual([
      'image_internal',
      'image_social',
      'medical_data_processing',
    ]);
  });

  // Un tipo que nadie haya dado de alta en el orden debe verse que sobra, no colarse.
  it('un tipo desconocido cae AL FINAL', () => {
    const s = secciones(
      [],
      [opcion({ consentType: 'inventado' }), opcion({ consentType: 'image_internal' })],
    );
    expect(s[0].kind === 'child' && s[0].rows.map((r) => r.consentType)).toEqual([
      'image_internal',
      'inventado',
    ]);
  });

  it('retirar solo si está concedido Y es retirable', () => {
    const s = secciones(
      [],
      [
        opcion({ consentType: 'image_internal', state: 'granted' }),
        opcion({ consentType: 'image_social', state: 'revoked' }),
        opcion({ consentType: 'medical_data_processing', state: 'never' }),
        opcion({ consentType: 'inventado', state: 'granted' }),
      ],
    );
    const porTipo = Object.fromEntries(
      (s[0].kind === 'child' ? s[0].rows : []).map((r) => [r.consentType, r.canRevoke]),
    );
    expect(porTipo).toEqual({
      image_internal: true,
      image_social: false,
      medical_data_processing: false,
      inventado: false,
    });
  });

  it('conceder solo si NO está concedido y el club tiene texto publicado', () => {
    const s = secciones(
      [],
      [
        opcion({ consentType: 'image_internal', state: 'granted' }),
        opcion({ consentType: 'image_social', state: 'revoked' }),
        opcion({ consentType: 'medical_data_processing', state: 'never' }),
      ],
    );
    const porTipo = Object.fromEntries(
      (s[0].kind === 'child' ? s[0].rows : []).map((r) => [r.consentType, r.canGrant]),
    );
    expect(porTipo).toEqual({
      image_internal: false,
      image_social: true,
      medical_data_processing: true,
    });
  });

  // El club no ha publicado el texto: no hay nada que aceptar. No se ofrece el botón y
  // se dice por qué — eso se arregla en el club, no en la app.
  it('sin documento vigente no hay botón, hay aviso', () => {
    const s = secciones(
      [],
      [
        opcion({
          consentType: 'image_social',
          state: 'never',
          signedDocumentId: null,
          signedDocumentTitle: null,
          currentDocumentId: null,
          currentDocumentTitle: null,
        }),
      ],
    );
    const row = s[0].kind === 'child' ? s[0].rows[0] : null;
    expect(row?.canGrant).toBe(false);
    expect(row?.needsClubDocument).toBe(true);
    expect(row?.title).toBeNull();
  });

  // Y al revés: si está concedido, que falte el texto vigente no es un aviso. Ya se
  // decidió; lo que se ve es lo que se firmó.
  it('un concedido sin texto vigente no pide nada al club', () => {
    const s = secciones(
      [],
      [opcion({ state: 'granted', currentDocumentId: null, currentDocumentTitle: null })],
    );
    const row = s[0].kind === 'child' ? s[0].rows[0] : null;
    expect(row?.needsClubDocument).toBe(false);
    expect(row?.canRevoke).toBe(true);
  });

  it('el título sale del firmado, y si no del vigente', () => {
    const s = secciones(
      [],
      [
        opcion({ consentType: 'image_internal', signedDocumentTitle: 'El firmado' }),
        opcion({
          consentType: 'image_social',
          state: 'never',
          signedDocumentId: null,
          signedDocumentTitle: null,
          currentDocumentTitle: 'El vigente',
        }),
      ],
    );
    expect(s[0].kind === 'child' && s[0].rows.map((r) => r.title)).toEqual([
      'El firmado',
      'El vigente',
    ]);
  });

  // Si la lista de retirables llegara vacía (core cambiado, import roto), la pantalla
  // se queda SIN botones en vez de ofrecerlos todos. Falla hacia el lado seguro, y en
  // los DOS sentidos: ni retirar ni conceder.
  it('sin tipos retirables no se pinta ningún botón', () => {
    const s = secciones([], [opcion({ state: 'never' }), opcion({ state: 'granted' })], []);
    const rows = s[0].kind === 'child' ? s[0].rows : [];
    expect(rows.map((r) => r.canRevoke)).toEqual([false, false]);
    expect(rows.map((r) => r.canGrant)).toEqual([false, false]);
    expect(rows.map((r) => r.needsClubDocument)).toEqual([false, false]);
  });

  it('dos hijos con el mismo nombre no bailan entre renders', () => {
    const entrada = [
      opcion({ playerId: 'p2', playerName: 'Ana' }),
      opcion({ playerId: 'p1', playerName: 'Ana' }),
    ];
    const a = secciones([], entrada);
    const b = secciones([], [...entrada].reverse());
    const ids = (s: ReturnType<typeof secciones>) =>
      s.map((x) => (x.kind === 'account' ? null : x.playerId));
    expect(ids(a)).toEqual(['p1', 'p2']);
    expect(ids(b)).toEqual(['p1', 'p2']);
  });

  it('un hijo sin nombre no rompe el orden', () => {
    const s = secciones(
      [],
      [
        opcion({ playerId: 'p2', playerName: null }),
        opcion({ playerId: 'p1', playerName: 'Ana' }),
      ],
    );
    expect(s).toHaveLength(2);
    expect(s.map((x) => (x.kind === 'account' ? null : x.playerName))).toEqual([null, 'Ana']);
  });

  it('las dos listas vacías son cero secciones', () => {
    expect(secciones([], [])).toEqual([]);
  });
});

describe('los avisos de efecto', () => {
  it.each([
    ['image_internal', 'revoke_effect.image_internal'],
    ['image_social', 'revoke_effect.image_social'],
    ['medical_data_processing', 'revoke_effect.medical'],
  ])('retirar %s tiene su propio aviso', (tipo, clave) => {
    expect(revokeEffectKey(tipo)).toBe(clave);
  });

  it.each([
    ['image_internal', 'grant_effect.image_internal'],
    ['image_social', 'grant_effect.image_social'],
    ['medical_data_processing', 'grant_effect.medical'],
  ])('conceder %s tiene su propio aviso', (tipo, clave) => {
    expect(grantEffectKey(tipo)).toBe(clave);
  });

  // Preferimos no decir nada a decir algo falso sobre el dato de un menor.
  it.each([revokeEffectKey, grantEffectKey])(
    'un tipo sin aviso propio devuelve null, no el del vecino',
    (fn) => {
      expect(fn('terms_conditions')).toBeNull();
      expect(fn('inventado')).toBeNull();
    },
  );

  // Retirar y conceder NO comparten texto: la imagen interna enciende la foto al
  // instante, el médico devuelve también la escritura y el de redes no enciende nada.
  it('ningún tipo comparte la clave entre retirar y conceder', () => {
    for (const t of RETIRABLES) {
      expect(grantEffectKey(t)).not.toBe(revokeEffectKey(t));
    }
  });
});

describe('consentTypeKey', () => {
  it('da el nombre del tipo para cuando no hay ningún documento', () => {
    expect(consentTypeKey('image_internal')).toBe('types.image_internal');
  });
});
