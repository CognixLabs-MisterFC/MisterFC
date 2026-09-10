import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { finalizeAccountDeletionFromClient, deletedEmailFor } from '../finalize';

function makeAdmin(resp: { data?: unknown; error?: unknown }) {
  return { rpc: () => Promise.resolve(resp) } as unknown as SupabaseClient<Database>;
}

describe('deletedEmailFor', () => {
  it('usa el dominio .invalid (RFC 2606: no puede recibir correo)', () => {
    expect(deletedEmailFor('abc-123')).toBe('deleted-abc-123@deleted.invalid');
  });
});

describe('finalizeAccountDeletionFromClient', () => {
  it('ORDEN: RPC → avatar → GoTrue (lo irreversible, lo último)', async () => {
    const order: string[] = [];
    const admin = {
      rpc: async () => {
        order.push('rpc');
        return { data: 'uid/avatar.jpg', error: null };
      },
    } as unknown as SupabaseClient<Database>;
    const r = await finalizeAccountDeletionFromClient(admin, 'uid', {
      removeAvatar: async (p) => {
        order.push(`avatar:${p}`);
      },
      neutralizeAuth: async () => {
        order.push('gotrue');
      },
    });
    expect(r).toEqual({ ok: true, alreadyResolved: false });
    expect(order).toEqual(['rpc', 'avatar:uid/avatar.jpg', 'gotrue']);
  });

  it('RPC que falla → NO toca ni Storage ni GoTrue (nada destruido, reintentable)', async () => {
    const removeAvatar = vi.fn();
    const neutralizeAuth = vi.fn();
    const err = { message: 'boom' };
    const r = await finalizeAccountDeletionFromClient(makeAdmin({ data: null, error: err }), 'uid', {
      removeAvatar,
      neutralizeAuth,
    });
    expect(r).toEqual({ ok: false, error: 'rpc_failed', raw: err });
    expect(removeAvatar).not.toHaveBeenCalled();
    expect(neutralizeAuth).not.toHaveBeenCalled();
  });

  it('sin avatar → no llama a Storage, pero SÍ neutraliza GoTrue', async () => {
    const removeAvatar = vi.fn();
    const neutralizeAuth = vi.fn(async () => {});
    const r = await finalizeAccountDeletionFromClient(makeAdmin({ data: null, error: null }), 'uid', {
      removeAvatar,
      neutralizeAuth,
    });
    expect(r).toEqual({ ok: true, alreadyResolved: true });
    expect(removeAvatar).not.toHaveBeenCalled();
    expect(neutralizeAuth).toHaveBeenCalledWith('uid');
  });

  it('Storage que falla → se logea y SIGUE: la anonimización ya está aplicada', async () => {
    const logError = vi.fn();
    const neutralizeAuth = vi.fn(async () => {});
    const r = await finalizeAccountDeletionFromClient(
      makeAdmin({ data: 'uid/avatar.jpg', error: null }),
      'uid',
      {
        removeAvatar: async () => {
          throw new Error('storage down');
        },
        neutralizeAuth,
        logError,
      },
    );
    expect(r).toEqual({ ok: true, alreadyResolved: false });
    expect(neutralizeAuth).toHaveBeenCalledTimes(1); // no se salta el paso 3
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('GoTrue intermitente → reintenta y acaba en verde', async () => {
    let calls = 0;
    const neutralizeAuth = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('502 bad gateway');
    });
    const r = await finalizeAccountDeletionFromClient(makeAdmin({ data: null, error: null }), 'uid', {
      removeAvatar: async () => {},
      neutralizeAuth,
      logError: () => {},
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('GoTrue caído del todo → error propio: anonimizada pero con credenciales vivas', async () => {
    const logError = vi.fn();
    const boom = new Error('gotrue down');
    const r = await finalizeAccountDeletionFromClient(makeAdmin({ data: null, error: null }), 'uid', {
      removeAvatar: async () => {},
      neutralizeAuth: async () => {
        throw boom;
      },
      logError,
    });
    expect(r).toEqual({ ok: false, error: 'auth_neutralize_failed', raw: boom });
    expect(logError).toHaveBeenCalledTimes(3); // los 3 intentos quedan logeados
  });
});
