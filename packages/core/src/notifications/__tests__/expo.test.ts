import { describe, expect, it } from 'vitest';
import {
  expoDataFromNotification,
  buildExpoMessages,
  isDeviceNotRegistered,
  tallyExpoTickets,
} from '../expo';

describe('expoDataFromNotification', () => {
  it('usa los IDs estructurados del payload (in_app) — type + ids', () => {
    const d = expoDataFromNotification('goal', {
      event_id: 'e1',
      team_id: 't1',
      deep_link: '/es/directos/e1',
    });
    expect(d).toEqual({ type: 'goal', event_id: 'e1', team_id: 't1' });
    // NO mete la ruta web ni un resource_id redundante cuando hay ids.
    expect(d.resource_id).toBeUndefined();
    expect((d as Record<string, string>).deep_link).toBeUndefined();
  });

  it('sin ids estructurados: extrae resource_id del deep_link SOLO si es UUID', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const d = expoDataFromNotification('match_callup_reminder', {
      deep_link: `/es/convocatorias/${uuid}`,
    });
    expect(d).toEqual({ type: 'match_callup_reminder', resource_id: uuid });
  });

  it('deep_link PLANO (sin id al final) → solo type, sin resource_id', () => {
    expect(
      expoDataFromNotification('training_reminder', { deep_link: '/es/calendario' }),
    ).toEqual({ type: 'training_reminder' });
    expect(
      expoDataFromNotification('new_message', { deep_link: '/es/mensajes' }),
    ).toEqual({ type: 'new_message' });
  });

  it('último segmento NO-UUID (slug) → no lo confunde con id', () => {
    expect(
      expoDataFromNotification('x', { deep_link: '/es/ajustes/notificaciones' }),
    ).toEqual({ type: 'x' });
  });

  it('payload nulo/indefinido → solo type (no peta)', () => {
    expect(expoDataFromNotification('goal', null)).toEqual({ type: 'goal' });
    expect(expoDataFromNotification('goal', undefined)).toEqual({ type: 'goal' });
  });
});

describe('buildExpoMessages', () => {
  it('un mensaje por token, mismo contenido + data', () => {
    const msgs = buildExpoMessages(
      ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
      { title: 'Gol', body: 'Fonteta 1 - 0' },
      { type: 'goal', event_id: 'e1' },
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      to: 'ExponentPushToken[a]',
      title: 'Gol',
      body: 'Fonteta 1 - 0',
      data: { type: 'goal', event_id: 'e1' },
      sound: 'default',
      priority: 'high',
    });
  });
});

describe('isDeviceNotRegistered / tallyExpoTickets', () => {
  const dead = {
    status: 'error',
    message: 'gone',
    details: { error: 'DeviceNotRegistered' },
  };
  const otherErr = {
    status: 'error',
    message: 'x',
    details: { error: 'MessageTooBig' },
  };

  it('detecta DeviceNotRegistered', () => {
    expect(isDeviceNotRegistered(dead)).toBe(true);
    expect(isDeviceNotRegistered(otherErr)).toBe(false);
    expect(isDeviceNotRegistered({ status: 'ok', id: 'r1' })).toBe(false);
    expect(isDeviceNotRegistered(null)).toBe(false);
  });

  it('clasifica tickets y saca los tokens muertos a limpiar', () => {
    const tokens = ['tkA', 'tkB', 'tkC'];
    const tickets = [{ status: 'ok', id: 'r1' }, dead, otherErr];
    const t = tallyExpoTickets(tokens, tickets);
    expect(t.sent).toBe(1);
    expect(t.failed_gone).toBe(1);
    expect(t.failed_other).toBe(1);
    expect(t.dead_tokens).toEqual(['tkB']);
  });

  it('sin tickets → todo a cero', () => {
    expect(tallyExpoTickets([], [])).toEqual({
      sent: 0,
      failed_gone: 0,
      failed_other: 0,
      dead_tokens: [],
    });
  });
});
