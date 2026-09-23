import { describe, expect, it } from 'vitest';
import { acceptedTickets, sweepExpoReceipts, type PendingTicket } from '../expo';

/**
 * El ticket dice que Expo cogió el mensaje. El RECIBO dice si FCM lo entregó.
 *
 * Esta distinción no es teórica: medido en producción el 2026-09-22, los 7 tokens
 * vivos devolvían ticket `ok` y recibo `DeviceNotRegistered`. Las notificaciones
 * llevaban semanas marcándose `sent` sin llegar a un solo teléfono, y la limpieza
 * de tokens muertos —que solo miraba tickets— no se ejecutó nunca.
 */

const pend = (ticketId: string, token: string, notificationId: string | null = 'n1'): PendingTicket => ({
  ticketId,
  token,
  notificationId,
});

describe('sweepExpoReceipts', () => {
  it('un recibo ok es una entrega de verdad', () => {
    const r = sweepExpoReceipts([pend('t1', 'ExponentPushToken[a]')], { t1: { status: 'ok' } });
    expect(r.delivered).toEqual(['t1']);
    expect(r.dead_tokens).toEqual([]);
    expect(r.resolved_ticket_ids).toEqual(['t1']);
  });

  // EL CASO QUE NO SE VEÍA: ticket ok, recibo DeviceNotRegistered.
  it('DeviceNotRegistered en el RECIBO manda borrar el token', () => {
    const r = sweepExpoReceipts([pend('t1', 'ExponentPushToken[muerto]')], {
      t1: { status: 'error', details: { error: 'DeviceNotRegistered' } },
    });
    expect(r.dead_tokens).toEqual(['ExponentPushToken[muerto]']);
    expect(r.delivered).toEqual([]);
    expect(r.resolved_ticket_ids).toEqual(['t1']);
  });

  // Un dispositivo que ya no existe NO es un aviso fallido: el aviso salió bien.
  // Marcarlo fallido haría que el drenador lo reintentara contra un token que
  // acabamos de borrar, para siempre.
  it('un token muerto no marca la notificación como fallida', () => {
    const r = sweepExpoReceipts([pend('t1', 'ExponentPushToken[muerto]')], {
      t1: { status: 'error', details: { error: 'DeviceNotRegistered' } },
    });
    expect(r.failed_notification_ids).toEqual([]);
  });

  it('otro error sí marca la notificación, para que se reintente', () => {
    const r = sweepExpoReceipts([pend('t1', 'ExponentPushToken[a]', 'n7')], {
      t1: { status: 'error', details: { error: 'MessageRateExceeded' } },
    });
    expect(r.failed_notification_ids).toEqual(['n7']);
    expect(r.dead_tokens).toEqual([]);
  });

  it('un error sin notificación asociada no inventa ninguna', () => {
    const r = sweepExpoReceipts([pend('t1', 'ExponentPushToken[a]', null)], {
      t1: { status: 'error', details: { error: 'MessageRateExceeded' } },
    });
    expect(r.failed_notification_ids).toEqual([]);
    expect(r.resolved_ticket_ids).toEqual(['t1']);
  });

  // Expo tarda en tener el recibo. Un ticket sin respuesta se QUEDA en la cola:
  // darlo por entregado sería la misma mentira que arregla este PR, y darlo por
  // fallido reintentaría un envío que probablemente sí llegó.
  it('un ticket sin recibo todavía se queda en la cola', () => {
    const r = sweepExpoReceipts([pend('t1', 'ExponentPushToken[a]')], {});
    expect(r.unresolved_ticket_ids).toEqual(['t1']);
    expect(r.resolved_ticket_ids).toEqual([]);
    expect(r.delivered).toEqual([]);
    expect(r.failed_notification_ids).toEqual([]);
  });

  // Una clave presente con valor `undefined` no es «sin recibo»: es un recibo que
  // no entendemos. Se resuelve (sale de la cola) y no se cuenta como entrega.
  it('distingue la clave ausente de una clave con valor vacío', () => {
    const r = sweepExpoReceipts([pend('t1', 'ExponentPushToken[a]')], { t1: undefined });
    expect(r.unresolved_ticket_ids).toEqual([]);
    expect(r.resolved_ticket_ids).toEqual(['t1']);
    expect(r.delivered).toEqual([]);
  });

  it('el mismo token muerto en dos avisos sale dos veces, y es correcto', () => {
    const r = sweepExpoReceipts(
      [pend('t1', 'ExponentPushToken[m]', 'n1'), pend('t2', 'ExponentPushToken[m]', 'n2')],
      {
        t1: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        t2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      },
    );
    // Repetir es inofensivo para el `in (...)` que borra, y dice cuántos envíos se
    // perdieron. Deduplicar aquí escondería ese número.
    expect(r.dead_tokens).toEqual(['ExponentPushToken[m]', 'ExponentPushToken[m]']);
  });

  it('una tanda mixta reparte cada ticket a su sitio', () => {
    const r = sweepExpoReceipts(
      [
        pend('ok1', 'ExponentPushToken[vivo]'),
        pend('dead1', 'ExponentPushToken[muerto]'),
        pend('err1', 'ExponentPushToken[otro]', 'n9'),
        pend('wait1', 'ExponentPushToken[lento]'),
      ],
      {
        ok1: { status: 'ok' },
        dead1: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        err1: { status: 'error', details: { error: 'InvalidCredentials' } },
      },
    );
    expect(r.delivered).toEqual(['ok1']);
    expect(r.dead_tokens).toEqual(['ExponentPushToken[muerto]']);
    expect(r.failed_notification_ids).toEqual(['n9']);
    expect(r.unresolved_ticket_ids).toEqual(['wait1']);
    expect(r.resolved_ticket_ids).toEqual(['ok1', 'dead1', 'err1']);
  });
});

describe('acceptedTickets', () => {
  it('encola solo los aceptados, emparejados con su token', () => {
    const out = acceptedTickets(
      ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
      [{ status: 'ok', id: 't1' }, { status: 'error', details: { error: 'x' } }],
      'n1',
    );
    expect(out).toEqual([{ ticketId: 't1', token: 'ExponentPushToken[a]', notificationId: 'n1' }]);
  });

  // Un ticket `ok` SIN id no se puede consultar después: encolarlo sería dejar una
  // fila que nunca se resuelve y que solo se borraría por antigüedad.
  it('descarta un ok sin id', () => {
    expect(acceptedTickets(['ExponentPushToken[a]'], [{ status: 'ok' }], 'n1')).toEqual([]);
  });

  it('el emparejado es POSICIONAL: Expo devuelve los tickets en el orden de los mensajes', () => {
    const out = acceptedTickets(
      ['ExponentPushToken[a]', 'ExponentPushToken[b]', 'ExponentPushToken[c]'],
      [
        { status: 'error', details: { error: 'x' } },
        { status: 'ok', id: 't2' },
        { status: 'ok', id: 't3' },
      ],
      null,
    );
    expect(out.map((o) => o.token)).toEqual([
      'ExponentPushToken[b]',
      'ExponentPushToken[c]',
    ]);
    expect(out.every((o) => o.notificationId === null)).toBe(true);
  });
});
