import { describe, expect, it, vi } from 'vitest';
import { isOnlineFromState, canAttemptFetch } from '../online-state';
import {
  OfflineError,
  isOfflineError,
  assertOnline,
  guardedWrite,
} from '../write-guard';
import { readThrough, cacheGet, cacheSet, type CacheBacking } from '../read-cache';

function memBacking(): CacheBacking & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => {
      store.set(k, v);
    },
    removeItem: async (k) => {
      store.delete(k);
    },
  };
}

describe('isOnlineFromState (fail-open)', () => {
  it('sin estado → online (no bloquea ante desconocido)', () => {
    expect(isOnlineFromState(null)).toBe(true);
    expect(isOnlineFromState(undefined)).toBe(true);
    expect(isOnlineFromState({})).toBe(true);
  });
  it('isConnected false → offline', () => {
    expect(isOnlineFromState({ isConnected: false })).toBe(false);
  });
  it('isInternetReachable false → offline', () => {
    expect(isOnlineFromState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
  it('conectado y reachable null → online', () => {
    expect(isOnlineFromState({ isConnected: true, isInternetReachable: null })).toBe(true);
  });
});

describe('canAttemptFetch (lecturas: solo isConnected===false es offline)', () => {
  it('sin estado → puede intentar (fail-open)', () => {
    expect(canAttemptFetch(null)).toBe(true);
    expect(canAttemptFetch(undefined)).toBe(true);
    expect(canAttemptFetch({})).toBe(true);
  });
  it('isConnected false → NO intenta (offline duro)', () => {
    expect(canAttemptFetch({ isConnected: false })).toBe(false);
  });
  it('reachability false transitoria con radio → SÍ intenta (no condena a caché)', () => {
    // Diferencia clave con isOnlineFromState: aquí la reachability se IGNORA.
    expect(canAttemptFetch({ isConnected: true, isInternetReachable: false })).toBe(true);
    expect(isOnlineFromState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});

describe('write-guard (offline = solo lectura)', () => {
  it('assertOnline no lanza online, lanza OfflineError offline', () => {
    expect(() => assertOnline(true)).not.toThrow();
    expect(() => assertOnline(false)).toThrow(OfflineError);
  });
  it('isOfflineError distingue el error', () => {
    expect(isOfflineError(new OfflineError())).toBe(true);
    expect(isOfflineError(new Error('x'))).toBe(false);
  });
  it('guardedWrite online ejecuta la mutación', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(guardedWrite(true, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });
  it('guardedWrite offline NO ejecuta la mutación y lanza', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(guardedWrite(false, fn)).rejects.toBeInstanceOf(OfflineError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('readThrough (stale-while-revalidate)', () => {
  /** Espera a que se invoque `onRevalidated` (revalidación en 2º plano del SWR). */
  function revalidatedOnce<T>(): {
    onRevalidated: (r: { data: T | null; fromCache: boolean }) => void;
    settled: Promise<{ data: T | null; fromCache: boolean }>;
  } {
    let resolve!: (r: { data: T | null; fromCache: boolean }) => void;
    const settled = new Promise<{ data: T | null; fromCache: boolean }>((res) => {
      resolve = res;
    });
    return { onRevalidated: (r) => resolve(r), settled };
  }

  it('online + SIN caché → BLOQUEA, devuelve fresco, fromCache false, y cachea', async () => {
    const backing = memBacking();
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    const r = await readThrough('k', fetcher, { isOnline: true, backing });
    expect(r).toEqual({ data: { v: 1 }, fromCache: false });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await cacheGet(backing, 'k')).toEqual({ v: 1 });
  });

  it('online + HAY caché → devuelve caché YA (fromCache false) y luego fresco por onRevalidated', async () => {
    const backing = memBacking();
    await cacheSet(backing, 'k', { v: 1 });
    const { onRevalidated, settled } = revalidatedOnce<{ v: number }>();
    const fetcher = vi.fn().mockResolvedValue({ v: 2 });

    // 1) Devuelve lo cacheado de inmediato, SIN banner.
    const immediate = await readThrough('k', fetcher, {
      isOnline: true,
      backing,
      onRevalidated,
    });
    expect(immediate).toEqual({ data: { v: 1 }, fromCache: false });

    // 2) La revalidación en 2º plano entrega lo fresco y lo cachea.
    const fresh = await settled;
    expect(fresh).toEqual({ data: { v: 2 }, fromCache: false });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await cacheGet(backing, 'k')).toEqual({ v: 2 });
  });

  it('online + HAY caché + revalidación FALLA → mantiene caché y onRevalidated marca banner', async () => {
    const backing = memBacking();
    await cacheSet(backing, 'k', { v: 4 });
    const { onRevalidated, settled } = revalidatedOnce<{ v: number }>();

    const immediate = await readThrough('k', async () => {
      throw new Error('red intermitente');
    }, { isOnline: true, backing, onRevalidated });
    // Se mostró la caché sin banner...
    expect(immediate).toEqual({ data: { v: 4 }, fromCache: false });
    // ...y al fallar la revalidación, se conserva la caché y se pide el banner.
    expect(await settled).toEqual({ data: { v: 4 }, fromCache: true });
    expect(await cacheGet(backing, 'k')).toEqual({ v: 4 });
  });

  it('OFFLINE + hay caché → cacheado, fromCache true, sin llamar al fetcher', async () => {
    const backing = memBacking();
    await cacheSet(backing, 'k', { v: 2 });
    const fetcher = vi.fn();
    const r = await readThrough('k', fetcher, { isOnline: false, backing });
    expect(r).toEqual({ data: { v: 2 }, fromCache: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('OFFLINE + sin caché → data null, fromCache true', async () => {
    const backing = memBacking();
    const r = await readThrough('k', async () => ({ v: 3 }), { isOnline: false, backing });
    expect(r).toEqual({ data: null, fromCache: true });
  });

  it('online + fetch FALLA + SIN caché → data null, fromCache true', async () => {
    const backing = memBacking();
    const r = await readThrough('k', async () => {
      throw new Error('boom');
    }, { isOnline: true, backing });
    expect(r).toEqual({ data: null, fromCache: true });
  });

  it('caché corrupta → cacheGet devuelve null', async () => {
    const backing = memBacking();
    backing.store.set('rcache.bad', '{no-json');
    expect(await cacheGet(backing, 'bad')).toBeNull();
  });
});
