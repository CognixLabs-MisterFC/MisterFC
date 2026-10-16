import { describe, it, expect } from 'vitest';
import {
  pushPayloadFromNotificationRow,
  decideNotificationOutcome,
  pushRowIsStale,
  PUSH_TTL_MINUTES,
  perishablePushTypes,
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

/**
 * El TEXTO del gol desde los ingredientes, y la CADUCIDAD en la cola.
 *
 * Los dos nacen del mismo agujero: el aviso de gol ahora puede nacer en el TRIGGER de
 * la base (`notify_goal`, mig 20261126000000), que guarda los ingredientes del
 * marcador y NO la frase —para que la frase viva en un solo sitio— y que puede dejar
 * la fila esperando en la cola hasta que pase el drenador.
 */
describe('gol nacido en el trigger: el texto se arma aquí', () => {
  const delTrigger = {
    event_id: 'ev-1',
    team_id: 'tm-1',
    deep_link: '/es/directos/ev-1',
    own: 2,
    rival: 1,
    team_name: 'Cadete A',
    opponent_name: 'CD Rival',
  };

  it('sin title/body en la fila, los arma con formatGoalPush', () => {
    const p = pushPayloadFromNotificationRow({ payload: delTrigger, type: 'goal' });
    expect(p.title).toBe('Gol');
    expect(p.body).toBe('Cadete A 2 - 1 CD Rival');
  });

  it('el tag sale del event_id, para que dos goles seguidos se colapsen', () => {
    const p = pushPayloadFromNotificationRow({ payload: delTrigger, type: 'goal' });
    expect(p.tag).toBe('goal:ev-1');
  });

  it('si la fila YA trae title/body (el emisor de web), manda la fila', () => {
    const p = pushPayloadFromNotificationRow({
      payload: { ...delTrigger, title: 'Gol!', body: 'otro texto', tag: 'goal:zzz' },
      type: 'goal',
    });
    expect(p.title).toBe('Gol!');
    expect(p.body).toBe('otro texto');
    expect(p.tag).toBe('goal:zzz');
  });

  it('sin rival es un amistoso sin nombre: el marcador se pinta igual', () => {
    const p = pushPayloadFromNotificationRow({
      payload: { ...delTrigger, opponent_name: null },
      type: 'goal',
    });
    expect(p.body).toBe('Cadete A 2 - 1');
  });

  it('ingredientes INCOMPLETOS → defaults de siempre, no una frase a medias', () => {
    const p = pushPayloadFromNotificationRow({
      payload: { event_id: 'ev-1', team_name: 'Cadete A' },
      type: 'goal',
    });
    expect(p.title).toBe('Gol');
    expect(p.body).toBe('');
  });

  it('otro tipo con los mismos números NO se formatea como gol', () => {
    const p = pushPayloadFromNotificationRow({
      payload: delTrigger,
      type: 'new_message',
    });
    expect(p.body).toBe('');
  });
});

describe('pushRowIsStale · avisos que caducan esperando en la cola', () => {
  const T0 = Date.parse('2026-10-24T10:00:00.000Z');
  const hace = (minutos: number) =>
    new Date(T0 - minutos * 60_000).toISOString();

  it('premisa: el gol es el único tipo con caducidad declarada hoy', () => {
    expect(PUSH_TTL_MINUTES.goal).toBe(10);
    expect(Object.keys(PUSH_TTL_MINUTES)).toEqual(['goal']);
  });

  it('un gol recién creado se envía', () => {
    expect(pushRowIsStale({ type: 'goal', created_at: hace(1) }, T0)).toBe(false);
  });

  it('un gol de hace 11 minutos ya no', () => {
    expect(pushRowIsStale({ type: 'goal', created_at: hace(11) }, T0)).toBe(true);
  });

  it('justo en el umbral (10 min) todavía se envía', () => {
    expect(pushRowIsStale({ type: 'goal', created_at: hace(10) }, T0)).toBe(false);
  });

  it('el caso que lo motivó: la fila espera al cron de las 08:00 → 14 horas', () => {
    expect(pushRowIsStale({ type: 'goal', created_at: hace(14 * 60) }, T0)).toBe(true);
  });

  it('un recordatorio de convocatoria NO caduca: llegar tarde es su diseño', () => {
    expect(
      pushRowIsStale({ type: 'match_callup_reminder', created_at: hace(14 * 60) }, T0),
    ).toBe(false);
    expect(
      pushRowIsStale({ type: 'attendance_pending_reminder', created_at: hace(999) }, T0),
    ).toBe(false);
  });

  it('fecha ilegible, ausente o futura → NO caduca (un fallo no es una edad)', () => {
    expect(pushRowIsStale({ type: 'goal', created_at: 'no-es-fecha' }, T0)).toBe(false);
    expect(pushRowIsStale({ type: 'goal', created_at: null }, T0)).toBe(false);
    expect(pushRowIsStale({ type: 'goal', created_at: undefined }, T0)).toBe(false);
    expect(pushRowIsStale({ type: 'goal', created_at: hace(-30) }, T0)).toBe(false);
  });
});

describe('perishablePushTypes · la lista sale del mapa, no a mano', () => {
  it('es exactamente las claves del mapa de TTL', () => {
    expect(perishablePushTypes()).toEqual(Object.keys(PUSH_TTL_MINUTES));
  });

  it('hoy es el gol, y solo el gol', () => {
    expect(perishablePushTypes()).toEqual(['goal']);
  });

  it('todo tipo perecedero tiene TTL, y al revés: no hay huérfanos', () => {
    for (const t of perishablePushTypes()) {
      expect(PUSH_TTL_MINUTES[t], `${t} esta en la lista sin TTL`).toBeGreaterThan(0);
    }
    expect(perishablePushTypes().length).toBe(Object.keys(PUSH_TTL_MINUTES).length);
  });

  // Los tres asertos de arriba NO distinguen la lista derivada de un ['goal'] escrito
  // a mano: hoy las dos dan lo mismo. El que lo distingue es este, que añade un tipo
  // al mapa en caliente y exige que la lista lo recoja sola.
  it('si mañana se añade un tipo perecedero, la lista lo recoge sola', () => {
    const mapa = PUSH_TTL_MINUTES as Record<string, number>;
    mapa.new_message = 5;
    try {
      expect(perishablePushTypes()).toContain('new_message');
    } finally {
      delete mapa.new_message;
    }
    expect(perishablePushTypes()).toEqual(['goal']);
  });
});
