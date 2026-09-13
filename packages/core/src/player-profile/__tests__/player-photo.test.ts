import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearPlayerPhotoFromClient,
  setPlayerPhotoPathFromClient,
} from '../sensitive';
import type { Database } from '../../supabase/types';

/**
 * "Quitar foto" tiene que BORRAR el objeto del bucket, no solo poner `photo_url` a
 * NULL: la pantalla promete que la foto desaparece. Estos tests miran exactamente eso
 * —qué llega a `storage.remove`— porque es lo único que distingue el arreglo del bug.
 */
function makeClient(
  rpcError: { message?: string } | null = null,
  opts: { current?: string | null; readError?: unknown } = {},
) {
  const calls: { rpc: Array<[string, unknown]>; removed: Array<[string, string]> } = {
    rpc: [],
    removed: [],
  };
  const sb = {
    rpc: (fn: string, args: unknown) => {
      calls.rpc.push([fn, args]);
      return Promise.resolve({ error: rpcError });
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { photo_url: opts.current ?? null },
              error: opts.readError ?? null,
            }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          for (const path of paths) calls.removed.push([bucket, path]);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, calls };
}

const PLAYER = '11111111-1111-1111-1111-111111111111';

describe('clearPlayerPhotoFromClient', () => {
  it('pone photo_url a NULL y BORRA el objeto', async () => {
    const previo = `${PLAYER}/vieja.jpg`;
    const { sb, calls } = makeClient(null, { current: previo });
    const r = await clearPlayerPhotoFromClient(sb, PLAYER);
    expect(r).toEqual({ ok: true });
    expect(calls.rpc[0][0]).toBe('set_player_photo');
    expect(calls.removed).toEqual([['player-photos', previo]]);
  });

  it('sin foto previa no borra nada', async () => {
    const { sb, calls } = makeClient(null, { current: null });
    await clearPlayerPhotoFromClient(sb, PLAYER);
    expect(calls.removed).toEqual([]);
  });

  it('si la RPC falla NO se borra el objeto', async () => {
    const { sb, calls } = makeClient(
      { message: 'forbidden' },
      { current: `${PLAYER}/vieja.jpg` },
    );
    const r = await clearPlayerPhotoFromClient(sb, PLAYER);
    expect(r).toEqual({ error: 'forbidden' });
    expect(calls.removed).toEqual([]);
  });

  it('si no se puede leer la ruta previa no se borra nada', async () => {
    const { sb, calls } = makeClient(null, {
      current: `${PLAYER}/vieja.jpg`,
      readError: { message: 'rls' },
    });
    await clearPlayerPhotoFromClient(sb, PLAYER);
    expect(calls.removed).toEqual([]);
  });
});

describe('setPlayerPhotoPathFromClient', () => {
  it('cambiar de foto borra la anterior', async () => {
    const previo = `${PLAYER}/vieja.jpg`;
    const { sb, calls } = makeClient(null, { current: previo });
    const r = await setPlayerPhotoPathFromClient(sb, PLAYER, `${PLAYER}/nueva.jpg`);
    expect(r).toEqual({ ok: true });
    expect(calls.removed).toEqual([['player-photos', previo]]);
  });

  it('guardar la MISMA ruta no borra la foto', async () => {
    const misma = `${PLAYER}/abc.jpg`;
    const { sb, calls } = makeClient(null, { current: misma });
    await setPlayerPhotoPathFromClient(sb, PLAYER, misma);
    expect(calls.removed).toEqual([]);
  });

  it('path fuera de la carpeta del jugador → forbidden, sin RPC ni borrado', async () => {
    const { sb, calls } = makeClient(null, { current: `${PLAYER}/vieja.jpg` });
    const r = await setPlayerPhotoPathFromClient(sb, PLAYER, 'otro/abc.jpg');
    expect(r).toEqual({ error: 'forbidden' });
    expect(calls.rpc).toEqual([]);
    expect(calls.removed).toEqual([]);
  });
});
