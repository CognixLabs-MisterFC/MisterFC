import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  SUBSCRIPTION_RECONCILE_CAP,
  reconcileSubscriptionsFromClient,
} from '../reconcile-sweep';

/**
 * SU-6b — la reconciliación nocturna.
 *
 * Lo que se vigila aquí no es el camino felíz: son las cuatro direcciones en las que un
 * barrido automático puede hacer daño de noche sin que nadie lo vea.
 *   · borrar un impago real (y con él la prioridad de la lista),
 *   · cortarle el acceso a quien paga porque una lectura salió rara,
 *   · aceptar datos de sandbox como si fueran de producción,
 *   · dar por bueno un 201, que significa que hemos creado un cliente que no existía.
 */

const PRODUCT = 'com.misterfc.app.suscripcion.anual';

type Candidate = {
  profile_id: string;
  app_user_id: string;
  rc_customer_id: string | null;
  access_until: string | null;
  billing_issue: boolean;
  reconciled_at: string | null;
  priority: string;
};

const candidate = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  profile_id: id,
  app_user_id: id,
  rc_customer_id: id,
  access_until: '2026-09-14T00:00:00Z',
  billing_issue: false,
  reconciled_at: null,
  priority: 'never',
  ...over,
});

type RpcCall = { name: string; args: Record<string, unknown> };

function makeAdmin(opts: {
  candidates?: Candidate[] | { error: unknown };
  stored?: { profile_id: string; billing_issue_detected_at: string | null }[] | { error: unknown };
  outcome?: string;
  rpcError?: unknown;
  calls?: RpcCall[];
}) {
  const calls = opts.calls ?? [];
  const cands = opts.candidates ?? [];
  const stored = opts.stored ?? [];

  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'subscription_reconcile_candidates') {
        return Promise.resolve(
          Array.isArray(cands)
            ? { data: cands, error: null }
            : { data: null, error: cands.error },
        );
      }
      if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
      return Promise.resolve({ data: opts.outcome ?? 'corrected', error: null });
    },
    from: () => ({
      select: () => ({
        in: () =>
          Promise.resolve(
            Array.isArray(stored)
              ? { data: stored, error: null }
              : { data: null, error: stored.error },
          ),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

/** Respuesta de `GET /subscribers` con el entitlement PREMIUM. */
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
          store_transaction_id: 'txn-1',
          ...over,
        },
      },
    },
  };
}

const fetchJson = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

const config = (fetchImpl: unknown) => ({ secretKey: 'sk_test', fetchImpl: fetchImpl as never });

const reconcileCalls = (calls: RpcCall[]) =>
  calls.filter((c) => c.name === 'reconcile_subscription_entitlement');

describe('reconcileSubscriptionsFromClient', () => {
  it('corrige lo que dice RevenueCat y lo cuenta', async () => {
    const calls: RpcCall[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1'), candidate('p2')], outcome: 'corrected', calls }),
      config(fetchJson(subscriberBody())),
    );
    expect(res).toMatchObject({ found: 2, attempted: 2, corrected: 2, failed: 0 });
    expect(reconcileCalls(calls)).toHaveLength(2);
  });

  it('pide la lista al SQL con el tope, no con un select propio', async () => {
    const calls: RpcCall[] = [];
    await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [], calls }),
      config(fetchJson(subscriberBody())),
    );
    expect(calls[0]).toMatchObject({
      name: 'subscription_reconcile_candidates',
      args: { p_limit: SUBSCRIPTION_RECONCILE_CAP },
    });
  });

  it('traslada tienda, producto y transacción tal como vienen normalizados', async () => {
    const calls: RpcCall[] = [];
    await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], calls }),
      config(fetchJson(subscriberBody())),
    );
    expect(reconcileCalls(calls)[0]?.args).toMatchObject({
      p_profile_id: 'p1',
      p_expires_at: '2027-09-12T10:00:00.000Z',
      p_store: 'APP_STORE',
      p_product_id: PRODUCT,
      p_store_transaction_id: 'txn-1',
      p_rc_customer_id: 'rc-1',
    });
  });

  // EL TEST QUE MÁS IMPORTA de este barrido. La API devuelve
  // `billing_issues_detected_at: null` aunque haya impago, así que copiarla borraría el
  // impago de todas las cuentas en la primera pasada.
  it('NO borra un impago que la API no devuelve', async () => {
    const calls: RpcCall[] = [];
    await reconcileSubscriptionsFromClient(
      makeAdmin({
        candidates: [candidate('p1', { billing_issue: true, priority: 'billing_issue' })],
        stored: [{ profile_id: 'p1', billing_issue_detected_at: '2026-08-20T09:00:00Z' }],
        calls,
      }),
      config(
        fetchJson(
          subscriberBody({
            grace_period_expires_date: '2026-09-20T00:00:00Z',
            billing_issues_detected_at: null,
          }),
        ),
      ),
      { now: () => new Date('2026-09-12T12:00:00Z') },
    );
    expect(reconcileCalls(calls)[0]?.args).toMatchObject({
      p_billing_issue_at: '2026-08-20T09:00:00Z',
      p_grace_period_expires_at: '2026-09-20T00:00:00.000Z',
    });
  });

  it('sin poder leer el impago guardado NO reconcilia nada', async () => {
    const calls: RpcCall[] = [];
    const logged: string[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({
        candidates: [candidate('p1'), candidate('p2')],
        stored: { error: { message: 'boom' } },
        calls,
      }),
      config(fetchJson(subscriberBody())),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res).toMatchObject({ found: 2, attempted: 0, corrected: 0 });
    expect(reconcileCalls(calls)).toHaveLength(0);
    expect(logged).toContain('reconcile_stored_read');
  });

  it('si no se puede leer la lista, no se toca nada', async () => {
    const logged: string[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: { error: { message: 'boom' } } }),
      config(fetchJson(subscriberBody())),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res).toMatchObject({ found: 0, attempted: 0 });
    expect(logged).toContain('reconcile_candidates_read');
  });

  it('una respuesta de sandbox no escribe NADA', async () => {
    const calls: RpcCall[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], calls }),
      config(fetchJson(subscriberBody({ is_sandbox: true }))),
    );
    expect(res).toMatchObject({ attempted: 1, sandbox: 1, corrected: 0, failed: 0 });
    expect(reconcileCalls(calls)).toHaveLength(0);
  });

  // Si RevenueCat no tiene la compra, los dos sistemas no se ponen de acuerdo en que
  // exista. NO se revoca: cortarle el acceso de noche a quien paga es el peor fallo
  // posible de esta serie. Se avisa.
  it('si RevenueCat no tiene entitlement, NO se revoca: se avisa', async () => {
    const calls: RpcCall[] = [];
    const logged: string[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], calls }),
      config(fetchJson(subscriberBody({}, false))),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res).toMatchObject({ attempted: 1, missingEntitlement: 1, corrected: 0 });
    expect(reconcileCalls(calls)).toHaveLength(0);
    expect(logged).toContain('reconcile_no_entitlement');
  });

  it('un fallo HTTP no escribe y se cuenta como fallo', async () => {
    const calls: RpcCall[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], calls }),
      config(fetchJson({ error: 'nope' }, 500)),
    );
    expect(res).toMatchObject({ attempted: 1, failed: 1, corrected: 0 });
    expect(reconcileCalls(calls)).toHaveLength(0);
  });

  // 201 = el GET ha CREADO el cliente. Aquí eso es un fallo, no un éxito: significa que
  // hemos preguntado por alguien que no existía.
  it('un 201 NO se aplica y queda como fallo', async () => {
    const calls: RpcCall[] = [];
    const logged: string[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], calls }),
      config(fetchJson(subscriberBody(), 201)),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res).toMatchObject({ attempted: 1, failed: 1, corrected: 0 });
    expect(reconcileCalls(calls)).toHaveLength(0);
    expect(logged).toContain('reconcile_customer_read');
  });

  it('una respuesta ilegible no se aplica', async () => {
    const calls: RpcCall[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], calls }),
      config(fetchJson({ nada: true })),
    );
    expect(res).toMatchObject({ attempted: 1, failed: 1 });
    expect(reconcileCalls(calls)).toHaveLength(0);
  });

  it('que el SQL diga desenganchada no es un fallo: es el candado funcionando', async () => {
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], outcome: 'skipped_unlinked' }),
      config(fetchJson(subscriberBody())),
    );
    expect(res).toMatchObject({ attempted: 1, skipped: 1, failed: 0, corrected: 0 });
  });

  it('un noop se cuenta aparte de una corrección', async () => {
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [candidate('p1')], outcome: 'noop' }),
      config(fetchJson(subscriberBody())),
    );
    expect(res).toMatchObject({ attempted: 1, noop: 1, corrected: 0 });
  });

  it('un error del RPC se cuenta como fallo y no rompe la pasada', async () => {
    const logged: string[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({
        candidates: [candidate('p1'), candidate('p2')],
        rpcError: { message: 'boom' },
      }),
      config(fetchJson(subscriberBody())),
      { logError: (_e, code) => logged.push(code) },
    );
    expect(res).toMatchObject({ found: 2, attempted: 2, failed: 2 });
    expect(logged.filter((c) => c === 'reconcile_apply')).toHaveLength(2);
  });

  it('sin candidatos no se lee nada más', async () => {
    const calls: RpcCall[] = [];
    const res = await reconcileSubscriptionsFromClient(
      makeAdmin({ candidates: [], calls }),
      config(fetchJson(subscriberBody())),
    );
    expect(res).toMatchObject({ found: 0, attempted: 0 });
    expect(calls).toHaveLength(1);
  });
});
