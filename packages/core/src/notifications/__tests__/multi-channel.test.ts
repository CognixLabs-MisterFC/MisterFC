import { describe, expect, it } from 'vitest';
import { mergeChannelOutcomes } from '../multi-channel';
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
