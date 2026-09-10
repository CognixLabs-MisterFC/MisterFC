import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  ACCOUNT_DELETION_SWEEP_CAP,
  finalizeDueAccountDeletionsFromClient,
  sweepStuckAuthNeutralizationsFromClient,
  type FinalizeOne,
} from '../sweeps';

/** Cliente falso que registra QUÉ RPC se pidió y devuelve lo que se le diga. */
function makeAdmin(resp: { data?: unknown; error?: unknown }, calls?: string[]) {
  return {
    rpc: (name: string) => {
      calls?.push(name);
      return Promise.resolve(resp);
    },
  } as unknown as SupabaseClient<Database>;
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ profile_id: `p${i}` }));

const okOne: FinalizeOne = async () => ({ ok: true, alreadyResolved: false });
const failOne: FinalizeOne = async () => ({
  ok: false,
  error: 'auth_neutralize_failed',
  raw: null,
});

describe('cada cola pregunta a SU RPC', () => {
  it('el plazo llama a account_deletions_due', async () => {
    const calls: string[] = [];
    await finalizeDueAccountDeletionsFromClient(makeAdmin({ data: [], error: null }, calls), {
      finalizeOne: okOne,
    });
    expect(calls).toEqual(['account_deletions_due']);
  });

  it('el barrido llama a account_deletions_auth_pending', async () => {
    const calls: string[] = [];
    await sweepStuckAuthNeutralizationsFromClient(makeAdmin({ data: [], error: null }, calls), {
      finalizeOne: okOne,
    });
    expect(calls).toEqual(['account_deletions_auth_pending']);
  });
});

describe('reparto y recuento', () => {
  it('cuenta lo que sale bien y lo que sale mal por separado', async () => {
    let n = 0;
    const finalizeOne: FinalizeOne = async () => (n++ % 2 === 0 ? okOne('x') : failOne('x'));
    const r = await sweepStuckAuthNeutralizationsFromClient(
      makeAdmin({ data: rows(4), error: null }),
      { finalizeOne },
    );
    expect(r).toEqual({ found: 4, attempted: 4, succeeded: 2, failed: 2 });
  });

  it('el TOPE recorta la tanda pero `found` sigue diciendo cuántas había', async () => {
    const finalizeOne = vi.fn(okOne);
    const r = await sweepStuckAuthNeutralizationsFromClient(
      makeAdmin({ data: rows(10), error: null }),
      { finalizeOne, cap: 3 },
    );
    // found > attempted es la señal de cola pendiente que el cron alerta.
    expect(r).toEqual({ found: 10, attempted: 3, succeeded: 3, failed: 0 });
    expect(finalizeOne).toHaveBeenCalledTimes(3);
  });

  it('en producción el tope por defecto es ACCOUNT_DELETION_SWEEP_CAP', async () => {
    const finalizeOne = vi.fn(okOne);
    const r = await finalizeDueAccountDeletionsFromClient(
      makeAdmin({ data: rows(ACCOUNT_DELETION_SWEEP_CAP + 5), error: null }),
      { finalizeOne },
    );
    expect(r.attempted).toBe(ACCOUNT_DELETION_SWEEP_CAP);
    expect(r.found).toBe(ACCOUNT_DELETION_SWEEP_CAP + 5);
  });

  it('se finaliza EXACTAMENTE el profile_id que devolvió la cola', async () => {
    const seen: string[] = [];
    await sweepStuckAuthNeutralizationsFromClient(
      makeAdmin({ data: [{ profile_id: 'aaa' }, { profile_id: 'bbb' }], error: null }),
      {
        finalizeOne: async (id) => {
          seen.push(id);
          return { ok: true, alreadyResolved: true };
        },
      },
    );
    expect(seen).toEqual(['aaa', 'bbb']);
  });
});

describe('cuando la cola no se puede leer', () => {
  it('NO finaliza a nadie: sin lista, tocar cuentas sería adivinar', async () => {
    const finalizeOne = vi.fn(okOne);
    const logError = vi.fn();
    const r = await sweepStuckAuthNeutralizationsFromClient(
      makeAdmin({ data: null, error: { message: 'boom' } }),
      { finalizeOne, logError },
    );
    expect(r).toEqual({ found: 0, attempted: 0, succeeded: 0, failed: 0 });
    expect(finalizeOne).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      { message: 'boom' },
      'account_deletions_auth_pending',
      {},
    );
  });

  it('una cola vacía (`data: null` sin error) no revienta', async () => {
    const r = await finalizeDueAccountDeletionsFromClient(makeAdmin({ data: null, error: null }), {
      finalizeOne: okOne,
    });
    expect(r).toEqual({ found: 0, attempted: 0, succeeded: 0, failed: 0 });
  });
});
