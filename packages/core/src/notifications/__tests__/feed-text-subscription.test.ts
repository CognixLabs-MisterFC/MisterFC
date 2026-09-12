import { describe, expect, it } from 'vitest';
import { notificationFeedText } from '../feed-text';

/** `t` de mentira: devuelve la CLAVE, para afirmar cuál se eligió sin acoplarse al copy. */
const t = (key: string, values?: Record<string, string>) =>
  values ? `${key}(${JSON.stringify(values)})` : key;

const text = (payload: unknown) => notificationFeedText(t, 'subscription_expiring', payload);

/**
 * SU-6b — el aviso de vencimiento tiene DOS textos y solo uno es accionable.
 *
 * Con impago sabemos qué pedir: que revise el método de pago en la tienda. Sin impago no
 * podemos prometer nada —no guardamos si la renovación automática sigue puesta
 * (`unsubscribe_detected_at` no tiene columna todavía)—, así que el texto neutro es
 * neutro a propósito. Lo que NO puede pasar es que el caso del impago caiga en el
 * neutro: sería un aviso que no dice qué hacer justo cuando hay algo que hacer.
 */
describe('subscription_expiring', () => {
  it('con impago → el texto accionable', () => {
    expect(text({ access_until: '2026-09-19T00:00:00Z', billing_issue: true })).toBe(
      'subscription_expiring_billing_issue',
    );
  });

  it('sin impago → el texto neutro', () => {
    expect(text({ access_until: '2026-09-19T00:00:00Z', billing_issue: false })).toBe(
      'subscription_expiring',
    );
  });

  it.each([null, undefined, {}, 'texto', 42, []])(
    'un payload que no dice nada (%p) cae al neutro, no al de impago',
    (payload) => {
      expect(text(payload)).toBe('subscription_expiring');
    },
  );

  // `billing_issue` lo escribe el SQL como booleano de verdad. Un "true" en texto sería
  // otra cosa (un payload manipulado o un cambio de la función), y no se trata como sí.
  it('solo un booleano true cuenta como impago', () => {
    expect(text({ billing_issue: 'true' })).toBe('subscription_expiring');
    expect(text({ billing_issue: 1 })).toBe('subscription_expiring');
  });

  // El payload es INMUTABLE (trigger de BC-7): el texto no puede depender de nada que
  // caduque, y por eso no lleva días restantes ni fecha interpolada.
  it('el texto no interpola nada del payload', () => {
    expect(text({ access_until: '2026-09-19T00:00:00Z', billing_issue: true })).not.toContain('(');
  });
});
