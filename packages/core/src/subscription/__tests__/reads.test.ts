import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { getMySubscriptionStatusFromClient } from '../reads';

/** Cliente falso: registra qué RPC se pidió y devuelve lo que se le diga. */
function makeClient(resp: { data?: unknown; error?: unknown }, calls?: string[]) {
  return {
    rpc: (name: string) => {
      calls?.push(name);
      return Promise.resolve(resp);
    },
  } as unknown as SupabaseClient<Database>;
}

const row = (o: Record<string, unknown> = {}) => ({
  requires_subscription: true,
  has_access: true,
  state: 'active',
  access_until: '2027-09-11T00:00:00Z',
  billing_issue: false,
  ...o,
});

describe('getMySubscriptionStatusFromClient', () => {
  it('llama a la RPC sin parámetros de destino', async () => {
    const calls: string[] = [];
    await getMySubscriptionStatusFromClient(makeClient({ data: [row()] }, calls));
    expect(calls).toEqual(['my_subscription_status']);
  });

  it('mapea la fila', async () => {
    const res = await getMySubscriptionStatusFromClient(makeClient({ data: [row()] }));
    expect(res).toEqual({
      ok: true,
      status: {
        requiresSubscription: true,
        hasAccess: true,
        state: 'active',
        accessUntil: '2027-09-11T00:00:00Z',
        billingIssue: false,
      },
    });
  });

  // El punto de la serie: una lectura muda aquí enseña la pantalla equivocada, en las
  // DOS direcciones (o muro de pago a quien pagó, o ningún muro a quien no).
  it('un error NO se traga: sale ok:false con el error crudo', async () => {
    const boom = { message: 'network' };
    const res = await getMySubscriptionStatusFromClient(makeClient({ error: boom }));
    expect(res).toEqual({ ok: false, raw: boom });
  });

  it('cero filas es un error, no un "no tiene suscripción"', async () => {
    const res = await getMySubscriptionStatusFromClient(makeClient({ data: [] }));
    expect(res.ok).toBe(false);
  });

  it('data nula también es un error', async () => {
    const res = await getMySubscriptionStatusFromClient(makeClient({ data: null }));
    expect(res.ok).toBe(false);
  });

  it('pasa la gracia con su marca de impago', async () => {
    const res = await getMySubscriptionStatusFromClient(
      makeClient({ data: [row({ state: 'grace', billing_issue: true })] }),
    );
    expect(res).toMatchObject({ ok: true, status: { state: 'grace', hasAccess: true } });
  });

  // Cliente viejo contra un SQL nuevo: lo que no se reconoce NO abre la puerta.
  it('un estado desconocido se cierra en vez de abrirse', async () => {
    const res = await getMySubscriptionStatusFromClient(
      makeClient({ data: [row({ state: 'algo_nuevo', has_access: true })] }),
    );
    expect(res).toMatchObject({ ok: true, status: { state: 'none', hasAccess: false } });
  });

  it('staff_free entra sin suscripción', async () => {
    const res = await getMySubscriptionStatusFromClient(
      makeClient({
        data: [
          row({
            requires_subscription: false,
            state: 'staff_free',
            access_until: null,
          }),
        ],
      }),
    );
    expect(res).toMatchObject({
      ok: true,
      status: { requiresSubscription: false, hasAccess: true, accessUntil: null },
    });
  });
});
