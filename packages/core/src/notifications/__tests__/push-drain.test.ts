import { describe, it, expect } from 'vitest';
import {
  pushPayloadFromNotificationRow,
  decideNotificationOutcome,
} from '../push-drain';

describe('pushPayloadFromNotificationRow', () => {
  it('saca title/body/deep_link/tag del payload', () => {
    const r = pushPayloadFromNotificationRow({
      payload: {
        title: 'Hola',
        body: 'Mundo',
        deep_link: '/es/mensajes/abc',
        tag: 'conv:abc',
      },
      type: 'new_message',
    });
    expect(r).toEqual({
      title: 'Hola',
      body: 'Mundo',
      deep_link: '/es/mensajes/abc',
      tag: 'conv:abc',
    });
  });

  it('default title segun type cuando falta', () => {
    const r = pushPayloadFromNotificationRow({
      payload: { body: 'b' },
      type: 'new_announcement',
    });
    expect(r.title).toBe('Nuevo anuncio');
    expect(r.tag).toBe('new_announcement');
  });

  it('body string vacío si falta', () => {
    const r = pushPayloadFromNotificationRow({
      payload: null,
      type: 'callup_published',
    });
    expect(r.body).toBe('');
    expect(r.title).toBe('Convocatoria publicada');
  });

  it('ignora payload con tipos inválidos', () => {
    const r = pushPayloadFromNotificationRow({
      payload: { title: 123, body: ['x'] } as never,
      type: 'training_reminder',
    });
    expect(r.title).toBe('Recordatorio de entrenamiento');
    expect(r.body).toBe('');
  });
});

describe('decideNotificationOutcome', () => {
  function base() {
    return {
      sent: 0,
      failed_gone: 0,
      failed_other: 0,
      skipped_user_pref: false,
      skipped_no_subscriptions: false,
    };
  }

  it('sent > 0 → sent', () => {
    const o = decideNotificationOutcome({ ...base(), sent: 1 });
    expect(o.status).toBe('sent');
    expect(o.mark_sent_at).toBe(true);
  });

  it('opt-out → skipped', () => {
    const o = decideNotificationOutcome({ ...base(), skipped_user_pref: true });
    expect(o.status).toBe('skipped');
  });

  it('sin subscripciones → pending (espera al user)', () => {
    const o = decideNotificationOutcome({
      ...base(),
      skipped_no_subscriptions: true,
    });
    expect(o.status).toBe('pending');
    expect(o.mark_sent_at).toBe(false);
  });

  it('todos los endpoints muertos (404/410) → failed', () => {
    const o = decideNotificationOutcome({ ...base(), failed_gone: 2 });
    expect(o.status).toBe('failed');
  });

  it('mezcla 410 + otros errores → pending (retry)', () => {
    const o = decideNotificationOutcome({
      ...base(),
      failed_gone: 1,
      failed_other: 1,
    });
    expect(o.status).toBe('pending');
  });

  it('solo otros errores → pending', () => {
    const o = decideNotificationOutcome({ ...base(), failed_other: 1 });
    expect(o.status).toBe('pending');
  });

  it('parcial: 1 sent + 1 gone → sent gana', () => {
    const o = decideNotificationOutcome({
      ...base(),
      sent: 1,
      failed_gone: 1,
    });
    expect(o.status).toBe('sent');
  });
});
