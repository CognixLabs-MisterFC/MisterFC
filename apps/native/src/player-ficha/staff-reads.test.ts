import { describe, expect, it } from 'vitest';
import { cacheGet, cacheSet, readThrough, type CacheBacking } from '@misterfc/core';
import type { NativeDbClient } from '@/data/client-data';
import { loadFichaMedical, loadFichaNotes } from './staff-reads';

/**
 * Lo que se mide aquí no es «el lector devuelve lo que devuelve la RPC», sino la
 * consecuencia que de verdad importa: QUÉ SE QUEDA GUARDADO en el móvil del
 * entrenador, que es un dato médico de un menor dentro de un teléfono.
 *
 * Por eso los dos casos de abajo no llaman solo al lector: lo montan sobre el
 * `readThrough` de verdad, con una caché de mentira, y miran la caché después.
 * Afirmar «lanzamos en los fallos de red» y dar por hecho el resto sería afirmar
 * del mecanismo habiendo medido un solo trozo del camino.
 *
 * Las dos mitades de `readThrough` (devolver pisa la caché, lanzar la conserva)
 * están ancladas en core, en `offline/__tests__/offline.test.ts`.
 */

/** Caché en memoria, como la de los tests de core. */
function memBacking(): CacheBacking {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
  };
}

type RpcResult = { data: unknown; error: { message: string } | null };

/** Cliente de mentira: las RPC por nombre y la consulta a `player_notes`. */
function client(cfg: { rpc?: Record<string, RpcResult>; notes?: RpcResult }): NativeDbClient {
  return {
    rpc: (fn: string) =>
      Promise.resolve(cfg.rpc?.[fn] ?? { data: null, error: { message: 'sin mock' } }),
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => Promise.resolve(cfg.notes ?? { data: [], error: null });
      return chain;
    },
  } as unknown as NativeDbClient;
}

const PLAYER = 'player-1';
const MEDICA = {
  allergies: 'polen',
  medication: null,
  medical_conditions: null,
  emergency_contact: '600 111 222',
};

/** Espera a que termine la revalidación en 2º plano del SWR. */
function revalidated<T>() {
  let resolve!: (r: { data: T | null; fromCache: boolean }) => void;
  const settled = new Promise<{ data: T | null; fromCache: boolean }>((r) => {
    resolve = r;
  });
  return { onRevalidated: (r: { data: T | null; fromCache: boolean }) => resolve(r), settled };
}

describe('la médica que se guarda en el móvil', () => {
  // ANCLA POSITIVA: si el cliente de mentira no respondiera por el nombre bueno,
  // los dos casos de abajo saldrían «bien» sin haber leído nada.
  it('con acceso devuelve la fila', async () => {
    const sb = client({ rpc: { get_player_medical: { data: [MEDICA], error: null } } });
    expect(await loadFichaMedical(sb, PLAYER)).toEqual({ ok: true, medical: MEDICA });
  });

  it('sin playerId no se consulta nada', async () => {
    const sb = client({});
    expect(await loadFichaMedical(sb, null)).toEqual({ ok: true, medical: null });
  });

  // RETIRADA DEL CONSENTIMIENTO. La RPC pasa a lanzar `forbidden`; eso es una
  // respuesta, se guarda, y PISA la copia que había. Es lo que promete la pantalla
  // de consentimientos: «dejará de verse en la aplicación».
  it('un forbidden BORRA de la caché la médica que ya estaba descargada', async () => {
    const backing = memBacking();
    await cacheSet(backing, 'ficha-staff-medica.c.p', { ok: true, medical: MEDICA });
    const sb = client({
      rpc: { get_player_medical: { data: null, error: { message: 'forbidden' } } },
    });
    const { onRevalidated, settled } = revalidated();

    await readThrough('ficha-staff-medica.c.p', () => loadFichaMedical(sb, PLAYER), {
      isOnline: true,
      backing,
      onRevalidated,
    });
    await settled;

    expect(await cacheGet(backing, 'ficha-staff-medica.c.p')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  // EL CAMPO SIN COBERTURA. Un fallo de red no dice nada sobre el permiso: la
  // copia descargada se queda, que es justo para lo que se descargó.
  it('un fallo de red CONSERVA la médica descargada', async () => {
    const backing = memBacking();
    await cacheSet(backing, 'ficha-staff-medica.c.p', { ok: true, medical: MEDICA });
    const sb = client({
      rpc: {
        get_player_medical: { data: null, error: { message: 'TypeError: Network request failed' } },
      },
    });
    const { onRevalidated, settled } = revalidated();

    await readThrough('ficha-staff-medica.c.p', () => loadFichaMedical(sb, PLAYER), {
      isOnline: true,
      backing,
      onRevalidated,
    });
    // La revalidación falla → se pide el banner de sin conexión...
    expect(await settled).toEqual({ data: { ok: true, medical: MEDICA }, fromCache: true });
    // ...y las alergias del crío siguen en el teléfono.
    expect(await cacheGet(backing, 'ficha-staff-medica.c.p')).toEqual({
      ok: true,
      medical: MEDICA,
    });
  });
});

describe('las notas siguen la misma regla', () => {
  const NOTA = {
    id: 'n1',
    note: 'Viene tocado del tobillo.',
    created_at: '2026-10-01T10:00:00Z',
    profiles: { full_name: 'Marta Ruiz' },
  };

  it('con acceso devuelve las notas', async () => {
    const sb = client({
      rpc: { user_can_access_player_notes: { data: true, error: null } },
      notes: { data: [NOTA], error: null },
    });
    expect(await loadFichaNotes(sb, PLAYER)).toEqual({
      ok: true,
      notes: [
        {
          id: 'n1',
          note: 'Viene tocado del tobillo.',
          createdAt: '2026-10-01T10:00:00Z',
          authorName: 'Marta Ruiz',
        },
      ],
    });
  });

  it('sin acceso devuelve forbidden (y no una lista vacía)', async () => {
    const sb = client({
      rpc: { user_can_access_player_notes: { data: false, error: null } },
      notes: { data: [], error: null },
    });
    expect(await loadFichaNotes(sb, PLAYER)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('un fallo de lectura LANZA, para no pisar las notas guardadas', async () => {
    const sb = client({
      rpc: { user_can_access_player_notes: { data: true, error: null } },
      notes: { data: null, error: { message: 'boom' } },
    });
    await expect(loadFichaNotes(sb, PLAYER)).rejects.toThrow();
  });
});
