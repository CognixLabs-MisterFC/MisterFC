import { describe, expect, it, vi } from 'vitest';
import {
  mergeChannelOutcomes,
  sendChannelIsolated,
  type ChannelResult,
} from '../multi-channel';
import { decideNotificationOutcome } from '../push-drain';

/** Atajo: merge + decisión de status final (lo que acaba en la fila). */
function status(
  wants: boolean,
  web: Parameters<typeof mergeChannelOutcomes>[1],
  expo: Parameters<typeof mergeChannelOutcomes>[2],
) {
  return decideNotificationOutcome(mergeChannelOutcomes(wants, web, expo)).status;
}

describe('mergeChannelOutcomes + status agregado (O2-4)', () => {
  it('gate off → skipped (ni se intenta)', () => {
    expect(status(false, { sent: 5, failed_gone: 0, failed_other: 0 }, null)).toBe(
      'skipped',
    );
  });

  it('cualquier destino entrega → sent (web solo)', () => {
    expect(status(true, { sent: 1, failed_gone: 0, failed_other: 0 }, null)).toBe(
      'sent',
    );
  });

  it('cualquier destino entrega → sent (expo solo)', () => {
    expect(status(true, null, { sent: 1, failed_gone: 0, failed_other: 0 })).toBe(
      'sent',
    );
  });

  it('web muerto pero expo entrega → sent (un fallo de web no marca failed lo que llegó por expo)', () => {
    expect(
      status(
        true,
        { sent: 0, failed_gone: 1, failed_other: 0 },
        { sent: 1, failed_gone: 0, failed_other: 0 },
      ),
    ).toBe('sent');
  });

  it('expo muerto pero web entrega → sent (ni al revés)', () => {
    expect(
      status(
        true,
        { sent: 1, failed_gone: 0, failed_other: 0 },
        { sent: 0, failed_gone: 1, failed_other: 0 },
      ),
    ).toBe('sent');
  });

  it('sin subs ni tokens (ambos null) → pending', () => {
    expect(status(true, null, null)).toBe('pending');
  });

  it('hubo intentos y TODOS muertos (web+expo gone, sent 0) → failed', () => {
    expect(
      status(
        true,
        { sent: 0, failed_gone: 1, failed_other: 0 },
        { sent: 0, failed_gone: 2, failed_other: 0 },
      ),
    ).toBe('failed');
  });

  it('solo errores transitorios (failed_other, sent 0) → pending (retry cron)', () => {
    expect(
      status(true, { sent: 0, failed_gone: 0, failed_other: 1 }, null),
    ).toBe('pending');
  });

  it('suma los contadores de ambos canales', () => {
    const m = mergeChannelOutcomes(
      true,
      { sent: 2, failed_gone: 1, failed_other: 0 },
      { sent: 3, failed_gone: 0, failed_other: 1 },
    );
    expect(m.sent).toBe(5);
    expect(m.failed_gone).toBe(1);
    expect(m.failed_other).toBe(1);
    expect(m.skipped_no_subscriptions).toBe(false);
  });
});

describe('sendChannelIsolated (aislamiento de fan-out O2-4)', () => {
  it('un canal que LANZA no propaga: degrada a fallo transitorio y reporta el error', async () => {
    const boom = new Error('expo push timeout');
    const onError = vi.fn();
    const r = await sendChannelIsolated(() => Promise.reject(boom), onError);
    expect(r).toEqual({ sent: 0, failed_gone: 0, failed_other: 1 });
    // El error NO se traga en silencio: queda registrado.
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('un canal que resuelve devuelve su outcome tal cual y NO reporta error', async () => {
    const onError = vi.fn();
    const out: ChannelResult = { sent: 3, failed_gone: 1, failed_other: 0 };
    const r = await sendChannelIsolated(() => Promise.resolve(out), onError);
    expect(r).toBe(out);
    expect(onError).not.toHaveBeenCalled();
  });

  it('null (sin destinos) se conserva y no cuenta como error', async () => {
    const onError = vi.fn();
    const r = await sendChannelIsolated(() => Promise.resolve(null), onError);
    expect(r).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});

/**
 * Simula EXACTAMENTE el fan-out de `sendPushToUser` (web-push.ts): dos canales
 * aislados en `Promise.all` + merge + status. Prueba que un throw de un canal no
 * tumba `sendPushToUser` ni el canal que ya entregó.
 */
async function fanOut(
  webThunk: () => Promise<ChannelResult>,
  expoThunk: () => Promise<ChannelResult>,
) {
  const errors: unknown[] = [];
  // Este Promise.all NUNCA rechaza porque cada canal va aislado — es la garantía.
  const [web, expo] = await Promise.all([
    sendChannelIsolated(webThunk, (e) => errors.push(e)),
    sendChannelIsolated(expoThunk, (e) => errors.push(e)),
  ]);
  const status = decideNotificationOutcome(
    mergeChannelOutcomes(true, web, expo),
  ).status;
  return { status, errors };
}

describe('fan-out aislado: un canal que lanza no tumba al otro (O2-4)', () => {
  it('expo LANZA pero web entregó → no rechaza, status sent, error registrado', async () => {
    const res = await fanOut(
      () => Promise.resolve({ sent: 1, failed_gone: 0, failed_other: 0 }),
      () => Promise.reject(new Error('expo API 503')),
    );
    expect(res.status).toBe('sent');
    expect(res.errors).toHaveLength(1);
  });

  it('simétrico: web LANZA pero expo entregó → status sent, error registrado', async () => {
    const res = await fanOut(
      () => Promise.reject(new Error('web-push ECONNRESET')),
      () => Promise.resolve({ sent: 1, failed_gone: 0, failed_other: 0 }),
    );
    expect(res.status).toBe('sent');
    expect(res.errors).toHaveLength(1);
  });

  it('ambos LANZAN → no rechaza, status pending (transitorio, retry cron), 2 errores', async () => {
    const res = await fanOut(
      () => Promise.reject(new Error('web down')),
      () => Promise.reject(new Error('expo down')),
    );
    expect(res.status).toBe('pending');
    expect(res.errors).toHaveLength(2);
  });

  it('expo LANZA y web NO tenía subs (null) → pending (transitorio), no failed', async () => {
    const res = await fanOut(
      () => Promise.resolve(null),
      () => Promise.reject(new Error('expo timeout')),
    );
    expect(res.status).toBe('pending');
    expect(res.errors).toHaveLength(1);
  });
});
