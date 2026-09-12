import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  SUBSCRIPTION_EXPIRY_NOTICE_DAYS,
  notifySubscriptionExpiringFromClient,
} from '../expiring-notice';

/**
 * SU-6b — el disparo del aviso. Todo el criterio vive en el SQL (a quién, la ventana, la
 * clave de dedupe), así que aquí solo se comprueba que no se invente nada por el camino:
 * los días que se piden y que un error NO se cuente como "avisados 0".
 */
function makeAdmin(result: { data?: unknown; error?: unknown }, calls: Record<string, unknown>[] = []) {
  return {
    rpc: (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  } as unknown as SupabaseClient<Database>;
}

describe('notifySubscriptionExpiringFromClient', () => {
  it('pide la ventana de 7 días', async () => {
    const calls: Record<string, unknown>[] = [];
    const res = await notifySubscriptionExpiringFromClient(makeAdmin({ data: 3 }, calls));
    expect(res).toEqual({ ok: true, notified: 3 });
    expect(calls[0]).toEqual({ p_days: SUBSCRIPTION_EXPIRY_NOTICE_DAYS });
  });

  it('respeta la ventana que se le pase', async () => {
    const calls: Record<string, unknown>[] = [];
    await notifySubscriptionExpiringFromClient(makeAdmin({ data: 0 }, calls), 3);
    expect(calls[0]).toEqual({ p_days: 3 });
  });

  // Un error que se devolviera como `notified: 0` haría que el cron dijera "todo bien,
  // no había a quién avisar" el día que la función falle.
  it('un error no se disfraza de "no había a quién avisar"', async () => {
    const res = await notifySubscriptionExpiringFromClient(makeAdmin({ error: { message: 'boom' } }));
    expect(res.ok).toBe(false);
  });

  it('una respuesta que no es número cuenta como 0 avisos, no como éxito inventado', async () => {
    const res = await notifySubscriptionExpiringFromClient(makeAdmin({ data: null }));
    expect(res).toEqual({ ok: true, notified: 0 });
  });
});
