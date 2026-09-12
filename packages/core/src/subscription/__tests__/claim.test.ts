import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { CLAIM_MIN_INTERVAL_MS, claimSubscriptionFromClient, resetClaimThrottle } from '../claim';

/**
 * SU-6b — la RECLAMACIÓN: "he pagado y sigo bloqueado".
 *
 * Es el único camino del sistema que pregunta a RevenueCat por una cuenta que no ha
 * pasado por `subscription_reconcile_candidates`, así que lo que se vigila aquí es
 * exactamente eso: que NO pregunte cuando no debe (una cuenta anonimizada o
 * desenganchada volvería a existir en RevenueCat con un 201), y que no regale acceso
 * cuando RevenueCat no dice que haya compra.
 */

const PRODUCT = 'com.misterfc.app.suscripcion.anual';
const P = '11111111-1111-4111-8111-111111111111';

type RpcCall = { name: string; args: Record<string, unknown> };

function makeAdmin(opts: {
  profile?: { id: string; deleted_at: string | null } | null;
  profileError?: unknown;
  entitlement?: {
    profile_id: string;
    unlinked_at: string | null;
    billing_issue_detected_at: string | null;
    reconciled_at: string | null;
  } | null;
  entitlementError?: unknown;
  ingest?: string;
  reconcile?: string;
  rpcError?: unknown;
  calls?: RpcCall[];
}) {
  const calls = opts.calls ?? [];
  const profile = opts.profile === undefined ? { id: P, deleted_at: null } : opts.profile;

  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === 'profiles') {
              return Promise.resolve(
                opts.profileError
                  ? { data: null, error: opts.profileError }
                  : { data: profile, error: null },
              );
            }
            return Promise.resolve(
              opts.entitlementError
                ? { data: null, error: opts.entitlementError }
                : { data: opts.entitlement ?? null, error: null },
            );
          },
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
      return Promise.resolve({
        data: name === 'apply_subscription_event' ? (opts.ingest ?? 'applied') : (opts.reconcile ?? 'corrected'),
        error: null,
      });
    },
  } as unknown as SupabaseClient<Database>;
}

function subscriberBody(over: Record<string, unknown> = {}, entitled = true) {
  return {
    subscriber: {
      original_app_user_id: 'rc-1',
      entitlements: entitled
        ? {
            PREMIUM: {
              expires_date: '2027-09-12T10:00:00Z',
              grace_period_expires_date: null,
              product_identifier: PRODUCT,
            },
          }
        : {},
      subscriptions: {
        [PRODUCT]: {
          expires_date: '2027-09-12T10:00:00Z',
          grace_period_expires_date: null,
          billing_issues_detected_at: null,
          is_sandbox: false,
          store: 'app_store',
          store_transaction_id: 'txn-9',
          ...over,
        },
      },
    },
  };
}

/** `fetch` que además apunta cuántas veces se ha llamado. */
function countingFetch(body: unknown, status = 200) {
  const state = { calls: 0 };
  const impl = (async () => {
    state.calls += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, state };
}

const config = (fetchImpl: unknown) => ({ secretKey: 'sk_test', fetchImpl: fetchImpl as never });

const entitlementRow = (over: Partial<{ unlinked_at: string | null; billing_issue_detected_at: string | null; reconciled_at: string | null }> = {}) => ({
  profile_id: P,
  unlinked_at: null,
  billing_issue_detected_at: null,
  reconciled_at: null,
  ...over,
});

beforeEach(() => {
  resetClaimThrottle();
});

describe('claimSubscriptionFromClient', () => {
  it('sin fila, crea la fila por el MISMO punto que el webhook', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: null, calls }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ ok: true, outcome: 'claimed' });
    const ingest = calls.find((c) => c.name === 'apply_subscription_event');
    expect(ingest?.args).toMatchObject({
      p_type: 'CLAIM',
      p_environment: 'PRODUCTION',
      p_app_user_id: P,
      p_expires_at: '2027-09-12T10:00:00.000Z',
      p_store: 'APP_STORE',
      p_store_transaction_id: 'txn-9',
    });
    // La transacción de la tienda va en el id: dos reclamaciones de la MISMA compra son
    // el mismo evento y la PK las cuenta como una.
    expect(String(ingest?.args.p_event_id)).toBe(`claim:${P}:txn-9`);
  });

  // `apply_subscription_event` solo guarda la gracia en un BILLING_ISSUE; un CLAIM no lo
  // es, así que si hay gracia hay que sellarla después.
  it('sella la gracia después de crear la fila', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(
      subscriberBody({ grace_period_expires_date: '2026-09-20T00:00:00Z' }),
    );
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: null, calls }),
      P,
      config(impl),
      { now: () => new Date('2026-09-12T12:00:00Z') },
    );
    expect(res).toMatchObject({ outcome: 'claimed' });
    const stamp = calls.find((c) => c.name === 'reconcile_subscription_entitlement');
    expect(stamp?.args).toMatchObject({
      p_grace_period_expires_at: '2026-09-20T00:00:00.000Z',
      p_billing_issue_at: '2026-09-12T12:00:00.000Z',
    });
  });

  it('sin gracia no hace la segunda escritura', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(subscriberBody());
    await claimSubscriptionFromClient(makeAdmin({ entitlement: null, calls }), P, config(impl));
    expect(calls.filter((c) => c.name === 'reconcile_subscription_entitlement')).toHaveLength(0);
  });

  it('con fila, es una reconciliación a petición (no un INSERT paralelo)', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: entitlementRow(), reconcile: 'corrected', calls }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ ok: true, outcome: 'corrected' });
    expect(calls.filter((c) => c.name === 'apply_subscription_event')).toHaveLength(0);
    expect(calls.filter((c) => c.name === 'reconcile_subscription_entitlement')).toHaveLength(1);
  });

  it('con fila ya correcta responde que no había nada que hacer', async () => {
    const { impl } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: entitlementRow(), reconcile: 'noop' }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ outcome: 'already_ok' });
  });

  it('conserva el impago guardado al reconciliar a petición', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(
      subscriberBody({ grace_period_expires_date: '2026-09-20T00:00:00Z' }),
    );
    await claimSubscriptionFromClient(
      makeAdmin({
        entitlement: entitlementRow({ billing_issue_detected_at: '2026-08-20T09:00:00Z' }),
        calls,
      }),
      P,
      config(impl),
      { now: () => new Date('2026-09-12T12:00:00Z') },
    );
    expect(
      calls.find((c) => c.name === 'reconcile_subscription_entitlement')?.args,
    ).toMatchObject({ p_billing_issue_at: '2026-08-20T09:00:00Z' });
  });

  // EL BLOQUE QUE MÁS IMPORTA. `GET /subscribers` CREA el cliente: preguntar por una
  // cuenta anonimizada la resucitaría en RevenueCat. Así que no se pregunta.
  it('una cuenta anonimizada NO llega a preguntar a RevenueCat', async () => {
    const calls: RpcCall[] = [];
    const { impl, state } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ profile: { id: P, deleted_at: '2026-09-01T00:00:00Z' }, calls }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ ok: true, outcome: 'unlinked' });
    expect(state.calls).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('un perfil que no existe tampoco pregunta', async () => {
    const { impl, state } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ profile: null }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ outcome: 'unlinked' });
    expect(state.calls).toBe(0);
  });

  it('una fila desenganchada tampoco pregunta', async () => {
    const { impl, state } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: entitlementRow({ unlinked_at: '2026-09-01T00:00:00Z' }) }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ outcome: 'unlinked' });
    expect(state.calls).toBe(0);
  });

  // Aquí el 201 sí se acepta —pregunta la propia persona por su cuenta viva— y lo único
  // que significa es que esta cuenta nunca compró nada.
  it('un 201 es "no has comprado nada", no un error', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(subscriberBody({}, false), 201);
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: null, calls }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ ok: true, outcome: 'no_entitlement' });
    expect(calls).toHaveLength(0);
  });

  it('sin compra en RevenueCat no se escribe nada', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(subscriberBody({}, false));
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: entitlementRow(), calls }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ outcome: 'no_entitlement' });
    expect(calls).toHaveLength(0);
  });

  it('una compra de sandbox no abre producción', async () => {
    const calls: RpcCall[] = [];
    const { impl } = countingFetch(subscriberBody({ is_sandbox: true }));
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: null, calls }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ outcome: 'sandbox' });
    expect(calls).toHaveLength(0);
  });

  it('dos reclamaciones seguidas: la segunda no llega a la red', async () => {
    const { impl, state } = countingFetch(subscriberBody());
    const admin = makeAdmin({ entitlement: null });
    const first = await claimSubscriptionFromClient(admin, P, config(impl));
    const second = await claimSubscriptionFromClient(admin, P, config(impl));
    expect(first).toMatchObject({ outcome: 'claimed' });
    expect(second).toMatchObject({ outcome: 'too_soon' });
    expect(state.calls).toBe(1);
  });

  it('una fila reconciliada hace un instante también frena', async () => {
    const { impl, state } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({
        entitlement: entitlementRow({ reconciled_at: '2026-09-12T11:59:30Z' }),
      }),
      P,
      config(impl),
      { now: () => new Date('2026-09-12T12:00:00Z') },
    );
    expect(res).toMatchObject({ outcome: 'too_soon' });
    expect(state.calls).toBe(0);
  });

  it('pasado el intervalo, deja volver a intentarlo', async () => {
    const { impl, state } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: entitlementRow({ reconciled_at: '2026-09-12T11:00:00Z' }) }),
      P,
      config(impl),
      { now: () => new Date(Date.parse('2026-09-12T11:00:00Z') + CLAIM_MIN_INTERVAL_MS + 1000) },
    );
    expect(res).toMatchObject({ ok: true });
    expect(state.calls).toBe(1);
  });

  it('si el SQL dice que la cuenta está borrada, no se traduce a éxito', async () => {
    const { impl } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: null, ingest: 'deleted_profile' }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ outcome: 'unlinked', ingest: 'deleted_profile' });
  });

  it('un duplicado es "ya está hecho" para quien reclama', async () => {
    const { impl } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: null, ingest: 'duplicate' }),
      P,
      config(impl),
    );
    expect(res).toMatchObject({ outcome: 'already_ok', ingest: 'duplicate' });
  });

  it('un error de lectura del perfil no se disfraza', async () => {
    const { impl, state } = countingFetch(subscriberBody());
    const res = await claimSubscriptionFromClient(
      makeAdmin({ profileError: { message: 'boom' } }),
      P,
      config(impl),
    );
    expect(res.ok).toBe(false);
    expect(state.calls).toBe(0);
  });

  it('un fallo HTTP se devuelve como fallo, no como "no tienes compra"', async () => {
    const logged: string[] = [];
    const { impl } = countingFetch({ error: 'nope' }, 500);
    const res = await claimSubscriptionFromClient(
      makeAdmin({ entitlement: null }),
      P,
      config(impl),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res.ok).toBe(false);
    expect(logged).toContain('claim_customer_read');
  });
});
