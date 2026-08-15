import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecureStoreAdapter } from './secure-store-adapter';
import { setStoredLocale, getStoredLocale, clearStoredLocale } from '../locale/store';

/**
 * Red de seguridad del BUG que tumbaba la app EN DISPOSITIVO (no en CI):
 * expo-secure-store 57.0.1 valida las claves con /^[\w.-]+$/ (SecureStore.js:151).
 * El adapter derivaba `${key}::chunks` / `${key}::${i}` para TODA escritura (incluida
 * la sesión de Supabase) → ':' inválido → la app moría en el primer setItemAsync.
 * CI no lo cazaba porque los tests de core usan un backing en memoria.
 *
 * Aquí interceptamos expo-secure-store y comprobamos que TODA clave que la app le
 * envía cumple la MISMA validación. Si alguien reintroduce un carácter inválido,
 * salta en CI, no en el móvil.
 */
const SECURE_STORE_KEY_RE = /^[\w.-]+$/;

// `keys` debe existir dentro del factory de vi.mock; vi.hoisted + vi.mock los sube
// vitest por encima de los imports de arriba (así el mock aplica al adapter/locale).
const { keys } = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => {
    keys.push(k);
    return null;
  }),
  setItemAsync: vi.fn(async (k: string) => {
    keys.push(k);
  }),
  deleteItemAsync: vi.fn(async (k: string) => {
    keys.push(k);
  }),
}));

afterEach(() => {
  keys.length = 0;
});

function expectAllKeysValid() {
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) {
    expect(k, `clave inválida para secure-store: "${k}"`).toMatch(SECURE_STORE_KEY_RE);
    expect(k, `clave con ':' prohibido: "${k}"`).not.toContain(':');
  }
}

// Valor grande → fuerza el troceo del adapter (countKey + varios chunkKey), que es
// donde estaba el '::'. Cubre las 3 familias de clave base que pasan por el adapter.
const BIG = 'x'.repeat(5000);

describe('claves que la app envía a expo-secure-store', () => {
  it('adapter — sesión de Supabase troceada: countKey/chunkKey válidas', async () => {
    await SecureStoreAdapter.setItem('sb-abcdefref-auth-token', BIG);
    expect(keys.some((k) => k.endsWith('.chunks'))).toBe(true); // countKey
    expect(keys.some((k) => /\.\d+$/.test(k))).toBe(true); // chunkKey
    expect(keys.some((k) => k.includes('::'))).toBe(false);
    expectAllKeysValid();
  });

  it('adapter — cola del directo (directo-queue.<eventId>) troceada: válidas', async () => {
    // Misma clave base que saveQueue (event-queue-store.ts:25) pasa al adapter.
    await SecureStoreAdapter.setItem('directo-queue.11112222-3333-4444-5555-666677778888', BIG);
    expectAllKeysValid();
  });

  it('adapter — caché de lectura (rcache.<key>) troceada: válidas', async () => {
    // Misma forma que secureCacheBacking → readThrough (PREFIX 'rcache.' + helper).
    await SecureStoreAdapter.setItem(
      'rcache.ficha.3f2504e0-4f89-41d3-9a0c-0305e82c3301.a1b2c3d4-e5f6-7890-abcd-ef1234567890.2025',
      BIG,
    );
    expectAllKeysValid();
  });

  it('locale — i18n_locale.<userId> válida (set/get/clear)', async () => {
    const uid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    await setStoredLocale(uid, 'es');
    await getStoredLocale(uid);
    await clearStoredLocale(uid);
    expectAllKeysValid();
  });

  it('regresión — la forma vieja con "::" habría fallado la validación', () => {
    expect('sb-ref-auth-token::chunks').not.toMatch(SECURE_STORE_KEY_RE);
    expect('i18n_locale::uuid').not.toMatch(SECURE_STORE_KEY_RE);
  });
});
