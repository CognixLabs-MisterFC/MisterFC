import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  STUCK_ATTEMPTS_THRESHOLD,
  SUBSCRIPTION_DELETION_SWEEP_CAP,
  sweepRevenueCatDeletionsFromClient,
} from '../deletion-sweep';
import { deleteRevenueCatCustomer, getRevenueCatCustomer } from '../revenuecat-api';

type Row = { profile_id: string; app_user_id: string; attempts: number };

/** Cliente falso: una lectura encadenada y updates que se apuntan. */
function makeAdmin(
  rows: Row[] | { error: unknown },
  updates: { profile_id: string; patch: Record<string, unknown> }[] = [],
  updateError: unknown = null,
) {
  const read = {
    select: () => read,
    is: () => read,
    order: () => read,
    limit: () =>
      Promise.resolve(
        Array.isArray(rows) ? { data: rows, error: null } : { data: null, error: rows.error },
      ),
  };
  return {
    from: () => ({
      ...read,
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          updates.push({ profile_id: id, patch });
          return Promise.resolve({ error: updateError });
        },
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

const okFetch = (status = 200) =>
  (async () => new Response(null, { status })) as unknown as typeof fetch;

const config = (fetchImpl: unknown) => ({
  secretKey: 'sk_test',
  fetchImpl: fetchImpl as never,
});

const row = (n: number, attempts = 0): Row => ({
  profile_id: `p${n}`,
  app_user_id: `p${n}`,
  attempts,
});

describe('sweepRevenueCatDeletionsFromClient', () => {
  it('borra y marca done_at', async () => {
    const updates: { profile_id: string; patch: Record<string, unknown> }[] = [];
    const res = await sweepRevenueCatDeletionsFromClient(
      makeAdmin([row(1), row(2)], updates),
      config(okFetch()),
    );
    expect(res).toMatchObject({ found: 2, attempted: 2, succeeded: 2, failed: 0 });
    expect(updates).toHaveLength(2);
    expect(updates[0]?.patch.done_at).toEqual(expect.any(String));
  });

  // 404 = ya no está en RevenueCat, que es exactamente lo que queríamos. Tratarlo como
  // fallo dejaría la fila reintentándose para siempre.
  it('un 404 cuenta como éxito', async () => {
    const updates: { profile_id: string; patch: Record<string, unknown> }[] = [];
    const res = await sweepRevenueCatDeletionsFromClient(
      makeAdmin([row(1)], updates),
      config(okFetch(404)),
    );
    expect(res.succeeded).toBe(1);
    expect(updates[0]?.patch.done_at).toEqual(expect.any(String));
  });

  it('un fallo NO marca done_at: suma intento y guarda el error', async () => {
    const updates: { profile_id: string; patch: Record<string, unknown> }[] = [];
    const res = await sweepRevenueCatDeletionsFromClient(
      makeAdmin([row(1, 2)], updates),
      config(okFetch(500)),
    );
    expect(res).toMatchObject({ succeeded: 0, failed: 1 });
    expect(updates[0]?.patch).toMatchObject({ attempts: 3, last_error: '500' });
    expect(updates[0]?.patch.done_at).toBeUndefined();
  });

  it('la red caída tampoco cierra la fila', async () => {
    const updates: { profile_id: string; patch: Record<string, unknown> }[] = [];
    const boom = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const res = await sweepRevenueCatDeletionsFromClient(makeAdmin([row(1)], updates), config(boom));
    expect(res.failed).toBe(1);
    expect(updates[0]?.patch).toMatchObject({ last_error: 'network' });
  });

  // Nunca se abandona una supresión: se sigue reintentando y se AVISA.
  it('una fila muy reintentada sale como stuck, pero se reintenta igual', async () => {
    const res = await sweepRevenueCatDeletionsFromClient(
      makeAdmin([row(1, STUCK_ATTEMPTS_THRESHOLD)]),
      config(okFetch(500)),
    );
    expect(res.stuck).toBe(1);
    expect(res.attempted).toBe(1);
  });

  it('respeta el tope y deja constancia de que queda cola', async () => {
    const many = Array.from({ length: SUBSCRIPTION_DELETION_SWEEP_CAP + 1 }, (_, i) => row(i));
    const res = await sweepRevenueCatDeletionsFromClient(makeAdmin(many), config(okFetch()));
    expect(res.attempted).toBe(SUBSCRIPTION_DELETION_SWEEP_CAP);
    expect(res.found).toBeGreaterThan(res.attempted);
  });

  it('si la lectura falla no se inventa una cola vacía silenciosa', async () => {
    const logged: string[] = [];
    const res = await sweepRevenueCatDeletionsFromClient(
      makeAdmin({ error: { message: 'boom' } }),
      config(okFetch()),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res).toMatchObject({ found: 0, attempted: 0 });
    expect(logged).toEqual(['revenuecat_deletion_queue_read']);
  });

  it('si el DELETE fue bien pero no se pudo apuntar, cuenta como fallo y se repite', async () => {
    const updates: { profile_id: string; patch: Record<string, unknown> }[] = [];
    const logged: string[] = [];
    const res = await sweepRevenueCatDeletionsFromClient(
      makeAdmin([row(1)], updates, { message: 'update boom' }),
      config(okFetch()),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res).toMatchObject({ succeeded: 0, failed: 1 });
    expect(logged).toContain('revenuecat_deletion_mark_done');
  });
});

describe('deleteRevenueCatCustomer', () => {
  it('manda el DELETE con la secret key en Bearer', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const spy = (async (url: string, init?: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await deleteRevenueCatCustomer('a b/c', config(spy));
    expect(seen.url).toBe('https://api.revenuecat.com/v1/subscribers/a%20b%2Fc');
    expect(seen.init?.method).toBe('DELETE');
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
  });
});

/**
 * El GET de RevenueCat CREA el cliente si no existe (201). Preguntar por una cuenta
 * anonimizada la resucitaría en su lado: el espejo exacto de lo que ADR-0022 impide.
 */
describe('getRevenueCatCustomer', () => {
  it('un 201 se trata como ERROR, porque significa que lo acabamos de crear', async () => {
    const res = await getRevenueCatCustomer('p1', config(okFetch(201)), true);
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ status: 201 });
  });

  it('un 200 devuelve el cliente', async () => {
    const json = (async () =>
      new Response(JSON.stringify({ subscriber: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const res = await getRevenueCatCustomer('p1', config(json), true);
    expect(res.ok).toBe(true);
  });
});
