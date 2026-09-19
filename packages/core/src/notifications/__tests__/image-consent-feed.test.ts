import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationFeedText } from '../feed-text';
import {
  imageConsentPlayerId,
  imageConsentPlayerIds,
  imageConsentPlayerOf,
  loadImageConsentPlayersFromClient,
  NO_IMAGE_CONSENT_PLAYERS,
  withImageConsentPlayerName,
  type ImageConsentPlayers,
} from '../image-consent';

/**
 * Imagen-2 — el aviso de retirada del permiso de imagen, en pantalla.
 *
 * Lo que se prueba aquí es lo que hace distinto a este aviso de los demás: dice CUÁL
 * de los dos permisos se ha retirado (interna o redes — el aviso genérico no vale), y
 * el nombre del jugador NO sale de la fila guardada sino de una lectura en vivo,
 * porque `notifications.payload` es inmutable (BC-7a) y un nombre ahí sobreviviría al
 * borrado del menor.
 */

/** `t` de mentira: devuelve la CLAVE + valores, sin acoplarse al copy. */
const t = (key: string, values?: Record<string, string>) =>
  values ? `${key}(${JSON.stringify(values)})` : key;

const text = (payload: unknown) => notificationFeedText(t, 'image_consent_revoked', payload);

const TYPE = 'image_consent_revoked';

describe('qué dice el aviso', () => {
  it('imagen interna, sin jugador resuelto → dice que es la interna', () => {
    expect(text({ player_id: 'p1', club_id: 'c1', consent_type: 'image_internal' })).toBe(
      'image_consent_revoked_internal',
    );
  });

  it('redes, sin jugador resuelto → dice que son las redes (no valdría un genérico)', () => {
    expect(text({ player_id: 'p1', club_id: 'c1', consent_type: 'image_social' })).toBe(
      'image_consent_revoked_social',
    );
  });

  it('con el jugador resuelto, lo nombra', () => {
    const players: ImageConsentPlayers = new Map([
      ['p1', { playerId: 'p1', name: 'Nil Garcia', photoUrl: null }],
    ]);
    const payload = { player_id: 'p1', consent_type: 'image_social' };
    expect(notificationFeedText(t, TYPE, withImageConsentPlayerName(TYPE, payload, players))).toBe(
      'image_consent_revoked_social_named({"name":"Nil Garcia"})',
    );
  });

  it('jugador que ya no se puede leer (borrado o fuera de la RLS) → texto sin nombre', () => {
    const payload = { player_id: 'p1', consent_type: 'image_internal' };
    const out = notificationFeedText(
      t,
      TYPE,
      withImageConsentPlayerName(TYPE, payload, NO_IMAGE_CONSENT_PLAYERS),
    );
    expect(out).toBe('image_consent_revoked_internal');
  });

  it('un consent_type desconocido cae en interna, no en un genérico mudo', () => {
    // Defensivo: el trigger solo dispara con los dos de imagen, pero si mañana
    // hubiera un tercero, la fila debe seguir diciendo algo útil.
    expect(text({ player_id: 'p1', consent_type: 'otro' })).toBe(
      'image_consent_revoked_internal',
    );
  });

  it('payload nulo o basura → no revienta', () => {
    expect(text(null)).toBe('image_consent_revoked_internal');
    expect(text('no soy un objeto')).toBe('image_consent_revoked_internal');
    expect(text([1, 2])).toBe('image_consent_revoked_internal');
  });
});

describe('el nombre NO se guarda nunca en la fila (BC-7a)', () => {
  it('un nombre que viniera en el payload guardado se ignora', () => {
    // Candado: el trigger no lo escribe, y si alguien lo añadiera, el aviso se
    // convertiría en el último rastro de un menor anonimizado.
    const players = NO_IMAGE_CONSENT_PLAYERS;
    const payload = { player_id: 'p1', consent_type: 'image_internal', player_name: 'Nil' };
    // La inyección en lectura no encuentra jugador → devuelve el payload TAL CUAL,
    // así que el único modo de que salga un nombre es que alguien lo hubiera guardado.
    // Lo que sí garantizamos es que NOSOTROS no lo ponemos.
    expect(withImageConsentPlayerName(TYPE, payload, players)).toBe(payload);
  });

  it('withImageConsentPlayerName no toca los avisos de otros tipos', () => {
    const players: ImageConsentPlayers = new Map([
      ['p1', { playerId: 'p1', name: 'Nil Garcia', photoUrl: null }],
    ]);
    const payload = { player_id: 'p1' };
    expect(withImageConsentPlayerName('tutor_unlinked', payload, players)).toBe(payload);
  });
});

describe('qué jugadores hay que resolver', () => {
  it('solo los de este tipo, y sin repetir', () => {
    const rows = [
      { type: 'new_message', payload: { player_id: 'otro' } },
      { type: TYPE, payload: { player_id: 'p1', consent_type: 'image_internal' } },
      { type: TYPE, payload: { player_id: 'p1', consent_type: 'image_social' } },
      { type: TYPE, payload: { player_id: 'p2', consent_type: 'image_social' } },
    ];
    expect(imageConsentPlayerIds(rows)).toEqual(['p1', 'p2']);
  });

  it('sin avisos de este tipo → lista vacía (el caller se ahorra la consulta)', () => {
    expect(imageConsentPlayerIds([{ type: 'goal', payload: { event_id: 'e1' } }])).toEqual([]);
  });

  it('aviso sin player_id → no se pide nada', () => {
    expect(imageConsentPlayerId(TYPE, { club_id: 'c1' })).toBeUndefined();
    expect(imageConsentPlayerIds([{ type: TYPE, payload: { club_id: 'c1' } }])).toEqual([]);
  });

  it('imageConsentPlayerOf devuelve null para cualquier otro tipo', () => {
    const players: ImageConsentPlayers = new Map([
      ['p1', { playerId: 'p1', name: 'Nil Garcia', photoUrl: null }],
    ]);
    expect(imageConsentPlayerOf('new_message', { player_id: 'p1' }, players)).toBeNull();
    expect(imageConsentPlayerOf(TYPE, { player_id: 'p1' }, players)?.name).toBe('Nil Garcia');
  });
});

/** Cliente de mentira: `players.select().in()` + `storage.createSignedUrls`. */
function fakeClient(cfg: {
  rows?: { id: string; first_name: string; last_name: string | null; photo_url: string | null }[];
  signed?: { path: string; signedUrl: string | null }[];
  onSign?: (paths: string[]) => void;
}) {
  return {
    from: () => ({
      select: () => ({
        in: async () => ({ data: cfg.rows ?? null, error: null }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          cfg.onSign?.(paths);
          return { data: cfg.signed ?? null, error: null };
        },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doble de test
  } as any;
}

describe('resolver jugador + foto', () => {
  it('nombre en orden natural y foto FIRMADA', async () => {
    const client = fakeClient({
      rows: [{ id: 'p1', first_name: 'Nil', last_name: 'Garcia', photo_url: 'club/p1.jpg' }],
      signed: [{ path: 'club/p1.jpg', signedUrl: 'https://firmada/p1' }],
    });
    const players = await loadImageConsentPlayersFromClient(client, ['p1']);
    expect(players.get('p1')).toEqual({
      playerId: 'p1',
      name: 'Nil Garcia',
      photoUrl: 'https://firmada/p1',
    });
  });

  it('jugador sin foto: sale con nombre y sin foto, y NO se pide firma', async () => {
    let signCalls = 0;
    const client = fakeClient({
      rows: [{ id: 'p1', first_name: 'Nil', last_name: null, photo_url: null }],
      onSign: () => {
        signCalls += 1;
      },
    });
    const players = await loadImageConsentPlayersFromClient(client, ['p1']);
    expect(players.get('p1')).toEqual({ playerId: 'p1', name: 'Nil', photoUrl: null });
    expect(signCalls).toBe(0);
  });

  it('si la firma falla, el aviso sigue: nombre sí, foto no', async () => {
    const client = fakeClient({
      rows: [{ id: 'p1', first_name: 'Nil', last_name: 'Garcia', photo_url: 'club/p1.jpg' }],
      signed: null as unknown as { path: string; signedUrl: string | null }[],
    });
    const players = await loadImageConsentPlayersFromClient(client, ['p1']);
    expect(players.get('p1')?.name).toBe('Nil Garcia');
    expect(players.get('p1')?.photoUrl).toBeNull();
  });

  it('sin ids NO toca la red', async () => {
    let touched = false;
    const client = {
      from: () => {
        touched = true;
        throw new Error('no debería consultar');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doble de test
    } as any;
    expect(await loadImageConsentPlayersFromClient(client, [])).toBe(NO_IMAGE_CONSENT_PLAYERS);
    expect(touched).toBe(false);
  });

  it('un jugador que la RLS no deja leer no aparece en el mapa', async () => {
    const client = fakeClient({
      rows: [{ id: 'p1', first_name: 'Nil', last_name: 'Garcia', photo_url: null }],
    });
    const players = await loadImageConsentPlayersFromClient(client, ['p1', 'p2']);
    expect(players.has('p1')).toBe(true);
    expect(players.has('p2')).toBe(false);
  });
});

function repoMessages(locale: string): Record<string, unknown> {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'messages', `${locale}.json`);
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro messages/${locale}.json subiendo desde ${process.cwd()}`);
}

describe('las claves existen de verdad en los tres catálogos', () => {
  const used = [
    'image_consent_revoked_internal',
    'image_consent_revoked_internal_named',
    'image_consent_revoked_social',
    'image_consent_revoked_social_named',
  ];

  for (const locale of ['es', 'en', 'va']) {
    it(`${locale}: home.feed tiene las 4 claves de Imagen-2`, () => {
      const msgs = repoMessages(locale) as { home: { feed: Record<string, string> } };
      for (const key of used) {
        expect(typeof msgs.home.feed[key], `falta home.feed.${key} en ${locale}`).toBe('string');
      }
    });

    it(`${locale}: las variantes con nombre llevan el placeholder`, () => {
      const feed = (repoMessages(locale) as { home: { feed: Record<string, string> } }).home.feed;
      expect(feed.image_consent_revoked_internal_named).toContain('{name}');
      expect(feed.image_consent_revoked_social_named).toContain('{name}');
    });

    it(`${locale}: interna y redes NO dicen lo mismo`, () => {
      const feed = (repoMessages(locale) as { home: { feed: Record<string, string> } }).home.feed;
      expect(feed.image_consent_revoked_internal).not.toBe(feed.image_consent_revoked_social);
    });
  }
});
