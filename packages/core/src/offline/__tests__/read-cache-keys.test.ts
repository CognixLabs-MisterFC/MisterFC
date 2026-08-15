import { describe, expect, it } from 'vitest';

import {
  cacheSet,
  clubScopedCacheKey,
  eventScopedCacheKey,
  playerEventScopedCacheKey,
  playerScopedCacheKey,
  profileScopedCacheKey,
  teamScopedCacheKey,
  type CacheBacking,
} from '../read-cache';

/**
 * Red de seguridad del BUG que tumbaba la app en dispositivo (no en CI):
 * expo-secure-store 57.0.1 valida las claves con /^[\w.-]+$/ (SecureStore.js:151),
 * así que ':' es inválido. Las claves de caché usaban '::' → la app moría al
 * arrancar. CI no lo cazó porque `readThrough` se testea con un backing en memoria
 * que no valida nada. Este test replica EXACTAMENTE la validación de expo-secure-store.
 *
 * Si alguien vuelve a meter un carácter inválido en una clave de caché, salta AQUÍ.
 */
const SECURE_STORE_KEY_RE = /^[\w.-]+$/;

const CLUB = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PLAYER = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TEAM = '0f0e0d0c-0b0a-0908-0706-050403020100';
const EVENT = '11112222-3333-4444-5555-666677778888';
const PROFILE = '99998888-7777-6666-5555-444433332211';

// Claves que producen los 6 helpers de read-cache, con args realistas (UUIDs).
const HELPER_KEYS: Record<string, string> = {
  clubScoped: clubScopedCacheKey('calendar', CLUB),
  eventScoped: eventScopedCacheKey('directo', EVENT),
  playerScoped: playerScopedCacheKey('ficha', CLUB, PLAYER),
  teamScoped: teamScopedCacheKey('plantilla', CLUB, TEAM),
  playerEventScoped: playerEventScopedCacheKey('convocatoria', CLUB, PLAYER, EVENT),
  profileScoped: profileScopedCacheKey('inbox', PROFILE),
};

// Claves INLINE construidas en pantallas nativas (helper + sufijos). Si añades una
// clave inline nueva en una pantalla, REGÍSTRALA aquí para que quede validada.
const INLINE_KEYS: Record<string, string> = {
  'family/mi-ficha': `${playerScopedCacheKey('ficha', CLUB, PLAYER)}.2025`,
  'family/mi-informe': `${playerScopedCacheKey('informe', CLUB, PLAYER)}.2025.T1`,
  'family/inicio': `inicio.${CLUB}.${PROFILE}`,
  'family/novedades': 'novedades.p1',
  'direction/inicio': `${clubScopedCacheKey('dir-inicio', CLUB)}.admin_club`,
};

describe('claves de caché válidas para expo-secure-store', () => {
  it.each(Object.entries(HELPER_KEYS))('helper %s → clave válida', (_name, key) => {
    expect(key).toMatch(SECURE_STORE_KEY_RE);
    expect(key).not.toContain(':');
  });

  it.each(Object.entries(INLINE_KEYS))('clave inline %s → válida', (_name, key) => {
    expect(key).toMatch(SECURE_STORE_KEY_RE);
    expect(key).not.toContain(':');
  });

  it('la clave COMPLETA almacenada (PREFIX incluido) es válida', async () => {
    const captured: string[] = [];
    const backing: CacheBacking = {
      getItem: async () => null,
      setItem: async (k) => {
        captured.push(k);
      },
      removeItem: async () => {},
    };
    const all = [...Object.values(HELPER_KEYS), ...Object.values(INLINE_KEYS)];
    for (const key of all) {
      await cacheSet(backing, key, { ok: 1 });
    }
    expect(captured).toHaveLength(all.length);
    for (const stored of captured) {
      // stored = PREFIX ('rcache.') + key. Debe seguir siendo válida.
      expect(stored).toMatch(SECURE_STORE_KEY_RE);
      expect(stored.startsWith('rcache.')).toBe(true);
    }
  });

  it('el regex replica el de expo-secure-store (rechaza ":", acepta [\\w.-])', () => {
    // La forma vieja (con '::') DEBE fallar: es la regresión que perseguimos.
    expect(SECURE_STORE_KEY_RE.test('rcache::ficha::clubId::playerId')).toBe(false);
    expect(SECURE_STORE_KEY_RE.test('inicio::clubId::a,b,c')).toBe(false); // ':' y ','
    // La forma nueva pasa.
    expect(SECURE_STORE_KEY_RE.test('rcache.ficha.clubId.playerId.2025')).toBe(true);
    // Vacía inválida (como en expo-secure-store: '+').
    expect(SECURE_STORE_KEY_RE.test('')).toBe(false);
  });
});
