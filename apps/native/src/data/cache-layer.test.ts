import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  coalesceFetch,
  msSinceLastFetch,
  __resetCoalescingForTests,
} from './request-coalescing';
import {
  invalidateResources,
  subscribeInvalidation,
  __resetCacheBusForTests,
} from './cache-bus';

/**
 * Tests de la capa de datos de la app (lógica PURA, entorno node):
 *  - dedupe in-flight por key (`coalesceFetch`)
 *  - intervalo mínimo (`msSinceLastFetch`)
 *  - invalidación por recurso del cache-bus (borra secure-store + notifica)
 *
 * Se sustituye el backing de secure-store por un Map en memoria (evita expo).
 * `vi.hoisted` + `vi.mock` los sube vitest por encima de los imports de arriba,
 * así el mock ya aplica cuando se carga `cache-bus` (que importa el backing).
 */
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('./secure-cache-backing', () => ({
  secureCacheBacking: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

afterEach(() => {
  __resetCoalescingForTests();
  __resetCacheBusForTests();
  store.clear();
  vi.restoreAllMocks();
});

describe('coalesceFetch — dedupe in-flight por key', () => {
  it('dos llamadas concurrentes a la misma key comparten un único fetch', async () => {
    let resolveFetch!: (v: number) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<number>((res) => {
          resolveFetch = res;
        }),
    );

    const p1 = coalesceFetch('k', fetcher);
    const p2 = coalesceFetch('k', fetcher);
    expect(p1).toBe(p2); // misma promesa
    expect(fetcher).toHaveBeenCalledOnce();

    resolveFetch(7);
    expect(await p1).toBe(7);
    expect(await p2).toBe(7);

    // Una vez resuelto, una nueva llamada SÍ vuelve a fetchar (no queda pegada).
    const fetcher2 = vi.fn().mockResolvedValue(9);
    expect(await coalesceFetch('k', fetcher2)).toBe(9);
    expect(fetcher2).toHaveBeenCalledOnce();
  });

  it('keys distintas no se deduplican entre sí', async () => {
    const fa = vi.fn().mockResolvedValue(1);
    const fb = vi.fn().mockResolvedValue(2);
    await Promise.all([coalesceFetch('a', fa), coalesceFetch('b', fb)]);
    expect(fa).toHaveBeenCalledOnce();
    expect(fb).toHaveBeenCalledOnce();
  });
});

describe('msSinceLastFetch — intervalo mínimo del refetch-al-enfocar', () => {
  it('Infinity antes de cualquier fetch; 0 justo después; crece con el tiempo', async () => {
    const clock = { t: 1_000_000 };
    vi.spyOn(Date, 'now').mockImplementation(() => clock.t);

    expect(msSinceLastFetch('k')).toBe(Number.POSITIVE_INFINITY);

    await coalesceFetch('k', async () => 1); // sella lastFetchAt = clock.t
    expect(msSinceLastFetch('k')).toBe(0);

    clock.t += 12_000;
    expect(msSinceLastFetch('k')).toBe(12_000);
  });

  it('registra el sello aunque el fetch falle (es "último intento")', async () => {
    const clock = { t: 5_000 };
    vi.spyOn(Date, 'now').mockImplementation(() => clock.t);
    await expect(
      coalesceFetch('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(msSinceLastFetch('k')).toBe(0);
  });
});

describe('cache-bus — invalidación por recurso', () => {
  it('borra de secure-store las keys conocidas que casan y avisa a sus suscriptores', async () => {
    const hitInicio = vi.fn();
    const hitHome = vi.fn();
    subscribeInvalidation('inicio.club1.tutorA', hitInicio);
    subscribeInvalidation('home.club1.teamX', hitHome);
    // Caché escrita para ambas (con el PREFIX real de read-cache, 'rcache.').
    store.set('rcache.inicio.club1.tutorA', '{"x":1}');
    store.set('rcache.home.club1.teamX', '{"y":2}');

    await invalidateResources(['inicio']);

    // La de 'inicio' se limpió y se notificó; la de 'home' quedó intacta.
    expect(store.has('rcache.inicio.club1.tutorA')).toBe(false);
    expect(hitInicio).toHaveBeenCalledOnce();
    expect(store.has('rcache.home.club1.teamX')).toBe(true);
    expect(hitHome).not.toHaveBeenCalled();
  });

  it('casa por TOKEN: "convocatoria" no afecta a "convocatorias"', async () => {
    const hitConv = vi.fn();
    const hitConvs = vi.fn();
    subscribeInvalidation('convocatoria.c.p.e', hitConv);
    subscribeInvalidation('convocatorias.c.p', hitConvs);

    await invalidateResources(['convocatoria']);

    expect(hitConv).toHaveBeenCalledOnce();
    expect(hitConvs).not.toHaveBeenCalled();
  });

  it('varios recursos a la vez; de-suscribir deja de recibir', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsub = subscribeInvalidation('inicio.c.t', a);
    subscribeInvalidation('novedades.p1', b);

    unsub();
    await invalidateResources(['inicio', 'novedades']);

    expect(a).not.toHaveBeenCalled(); // de-suscrito
    expect(b).toHaveBeenCalledOnce();
  });
});
