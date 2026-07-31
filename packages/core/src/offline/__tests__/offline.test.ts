import { describe, expect, it, vi } from 'vitest';
import { isOnlineFromState } from '../online-state';
import {
  OfflineError,
  isOfflineError,
  assertOnline,
  guardedWrite,
} from '../write-guard';
import { readThrough, cacheGet, type CacheBacking } from '../read-cache';

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

describe('readThrough (cache-first con revalidación)', () => {
  it('online + fetch ok → fresco, fromCache false, y cachea', async () => {
    const backing = memBacking();
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    const r = await readThrough('k', fetcher, { isOnline: true, backing });
    expect(r).toEqual({ data: { v: 1 }, fromCache: false });
    // quedó cacheado
    expect(await cacheGet(backing, 'k')).toEqual({ v: 1 });
  });

  it('offline + hay caché → cacheado, fromCache true, sin llamar al fetcher', async () => {
    const backing = memBacking();
    await readThrough('k', async () => ({ v: 2 }), { isOnline: true, backing });
    const fetcher = vi.fn();
    const r = await readThrough('k', fetcher, { isOnline: false, backing });
    expect(r).toEqual({ data: { v: 2 }, fromCache: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('offline + sin caché → data null, fromCache true', async () => {
    const backing = memBacking();
    const r = await readThrough('k', async () => ({ v: 3 }), { isOnline: false, backing });
    expect(r).toEqual({ data: null, fromCache: true });
  });

  it('online + fetch FALLA + hay caché → cae a lo cacheado', async () => {
    const backing = memBacking();
    await readThrough('k', async () => ({ v: 4 }), { isOnline: true, backing });
    const r = await readThrough('k', async () => {
      throw new Error('red intermitente');
    }, { isOnline: true, backing });
    expect(r).toEqual({ data: { v: 4 }, fromCache: true });
  });

  it('online + fetch FALLA + sin caché → data null', async () => {
    const backing = memBacking();
    const r = await readThrough('k', async () => {
      throw new Error('boom');
    }, { isOnline: true, backing });
    expect(r).toEqual({ data: null, fromCache: true });
  });

  it('caché corrupta → cacheGet devuelve null', async () => {
    const backing = memBacking();
    backing.store.set('rcache::bad', '{no-json');
    expect(await cacheGet(backing, 'bad')).toBeNull();
  });
});
