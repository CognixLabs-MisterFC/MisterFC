import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decidePlayerErasureFromClient } from '../actions';
import type { Database } from '../../supabase/types';

/** Mock de `.rpc('decide_player_erasure')`: data = ruta de foto (o null). */
function makeClient(resp: { data?: unknown; error?: unknown }) {
  return {
    rpc: () => Promise.resolve(resp),
  } as unknown as SupabaseClient<Database>;
}

describe('decidePlayerErasureFromClient', () => {
  it('APROBAR con ruta → borrado de storage DESPUÉS de la RPC (con esa ruta)', async () => {
    const order: string[] = [];
    const removePhoto = vi.fn(async (p: string) => {
      order.push(`remove:${p}`);
    });
    const sb = {
      rpc: async () => {
        order.push('rpc');
        return { data: 'club/abc/photo.jpg', error: null };
      },
    } as unknown as SupabaseClient<Database>;
    const r = await decidePlayerErasureFromClient(sb, 'req1', true, null, removePhoto);
    expect(r).toEqual({ success: true });
    expect(removePhoto).toHaveBeenCalledWith('club/abc/photo.jpg');
    expect(order).toEqual(['rpc', 'remove:club/abc/photo.jpg']); // storage DESPUÉS de la RPC
  });

  it('RECHAZAR → RPC plana, SIN borrado de storage (service-role)', async () => {
    const removePhoto = vi.fn();
    const sb = makeClient({ data: null, error: null });
    const r = await decidePlayerErasureFromClient(sb, 'req1', false, 'no procede', removePhoto);
    expect(r).toEqual({ success: true });
    expect(removePhoto).not.toHaveBeenCalled();
  });

  it('APROBAR sin ruta de foto → sin borrado de storage', async () => {
    const removePhoto = vi.fn();
    const sb = makeClient({ data: null, error: null });
    const r = await decidePlayerErasureFromClient(sb, 'req1', true, null, removePhoto);
    expect(r).toEqual({ success: true });
    expect(removePhoto).not.toHaveBeenCalled();
  });

  it('storage remove que falla tras la RPC → logger, NO revierte (success)', async () => {
    const removePhoto = vi.fn().mockRejectedValue(new Error('storage down'));
    const logError = vi.fn();
    const sb = makeClient({ data: 'club/abc/photo.jpg', error: null });
    const r = await decidePlayerErasureFromClient(sb, 'req1', true, null, removePhoto, logError);
    expect(r).toEqual({ success: true }); // la supresión NO se revierte
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('mapea errores de la RPC (forbidden / already_decided / not_found / generic)', async () => {
    const rp = vi.fn();
    expect(await decidePlayerErasureFromClient(makeClient({ error: { message: 'forbidden' } }), 'r', true, null, rp)).toEqual({ success: false, error: 'forbidden' });
    expect(await decidePlayerErasureFromClient(makeClient({ error: { message: 'already_decided' } }), 'r', true, null, rp)).toEqual({ success: false, error: 'already_decided' });
    expect(await decidePlayerErasureFromClient(makeClient({ error: { message: 'not_found' } }), 'r', true, null, rp)).toEqual({ success: false, error: 'not_found' });
    expect(await decidePlayerErasureFromClient(makeClient({ error: { message: 'weird' } }), 'r', true, null, rp)).toEqual({ success: false, error: 'generic' });
    expect(rp).not.toHaveBeenCalled(); // ningún error dispara el storage
  });
});
