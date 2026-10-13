import { describe, it, expect } from 'vitest';
import { startNextPeriodSchema, adjustClockSchema } from '../match-clock';
import { PERIOD_KINDS, periodOrder } from '../../match/clock';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

describe('startNextPeriodSchema — la puerta de entrada del periodo', () => {
  it('acepta el tercer tiempo', () => {
    // Si el enum no lo admitiera, el botón «Empezar 3er tiempo» de un partido
    // de querubines moriría en la validación con `period_invalid` y el reloj
    // nunca llegaría a la base: el motor sería correcto y la pantalla no.
    const r = startNextPeriodSchema.safeParse({
      event_id: EVENT_ID,
      period: 'third_period',
    });
    expect(r.success).toBe(true);
  });

  it('acepta TODOS los periodos del catálogo, no una lista aparte', () => {
    // El enum se construye desde PERIOD_KINDS justo para que no haya una cuarta
    // lista que derive. Esto lo afirma: si mañana se añade un periodo al
    // catálogo y el enum deja de leerse de ahí, este test se cae.
    for (const kind of PERIOD_KINDS) {
      const r = startNextPeriodSchema.safeParse({ event_id: EVENT_ID, period: kind });
      expect(r.success, `rechazó ${kind}`).toBe(true);
    }
    // Y cubre el orden de las dos categorías, que es de donde salen las
    // peticiones reales (periodOrder(3) incluye el tercer tiempo).
    for (const kind of [...periodOrder(2), ...periodOrder(3)]) {
      expect(startNextPeriodSchema.safeParse({ event_id: EVENT_ID, period: kind }).success).toBe(
        true,
      );
    }
  });

  it('rechaza un periodo inventado y un id que no es uuid', () => {
    const malPeriodo = startNextPeriodSchema.safeParse({
      event_id: EVENT_ID,
      period: 'fourth_period',
    });
    expect(malPeriodo.success).toBe(false);
    expect(startNextPeriodSchema.safeParse({ event_id: 'x', period: 'first_half' }).success).toBe(
      false,
    );
  });
});

describe('adjustClockSchema', () => {
  it('acepta un delta entero distinto de 0 dentro del tope', () => {
    expect(adjustClockSchema.safeParse({ event_id: EVENT_ID, delta_seconds: -30 }).success).toBe(
      true,
    );
  });

  it('rechaza 0, fracciones y fuera de tope', () => {
    for (const delta of [0, 1.5, 5401, -5401]) {
      expect(
        adjustClockSchema.safeParse({ event_id: EVENT_ID, delta_seconds: delta }).success,
        `aceptó ${delta}`,
      ).toBe(false);
    }
  });
});
