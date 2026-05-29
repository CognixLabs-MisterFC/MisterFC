import { describe, it, expect } from 'vitest';
import {
  fromZonedFields,
  zonedFields,
  zonedIsoWeekday,
} from '../tz';

const MADRID = 'Europe/Madrid';

describe('zonedFields', () => {
  it('extrae Y/M/D/h/m/s en Europe/Madrid', () => {
    // 2026-05-15T10:30:00Z → en Madrid (CEST, UTC+2) son 12:30.
    const d = new Date('2026-05-15T10:30:00Z');
    const f = zonedFields(d, MADRID);
    expect(f).toEqual({
      year: 2026,
      month: 4, // 0-based
      day: 15,
      hour: 12,
      minute: 30,
      second: 0,
    });
  });

  it('extrae correctamente en horario estándar (CET, UTC+1)', () => {
    const d = new Date('2026-01-15T10:30:00Z');
    const f = zonedFields(d, MADRID);
    expect(f.hour).toBe(11);
    expect(f.minute).toBe(30);
  });
});

describe('fromZonedFields', () => {
  it('convierte 2026-05-15 18:00 Madrid → UTC 16:00 (CEST)', () => {
    const utc = fromZonedFields(2026, 4, 15, 18, 0, MADRID);
    expect(utc.toISOString()).toBe('2026-05-15T16:00:00.000Z');
  });

  it('convierte 2026-01-15 18:00 Madrid → UTC 17:00 (CET)', () => {
    const utc = fromZonedFields(2026, 0, 15, 18, 0, MADRID);
    expect(utc.toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('atraviesa cambio DST primavera (29 marzo 2026): 18:00 local mantiene offset correcto', () => {
    // Antes del cambio (28 marzo 18:00 Madrid = UTC 17:00, CET).
    const pre = fromZonedFields(2026, 2, 28, 18, 0, MADRID);
    // Después del cambio (29 marzo 18:00 Madrid = UTC 16:00, CEST).
    const post = fromZonedFields(2026, 2, 29, 18, 0, MADRID);
    expect(pre.toISOString()).toBe('2026-03-28T17:00:00.000Z');
    expect(post.toISOString()).toBe('2026-03-29T16:00:00.000Z');
  });

  it('atraviesa cambio DST otoño (25 octubre 2026): 18:00 local correcto a cada lado', () => {
    // 24 octubre 18:00 Madrid → UTC 16:00 (CEST).
    const pre = fromZonedFields(2026, 9, 24, 18, 0, MADRID);
    // 26 octubre 18:00 Madrid → UTC 17:00 (CET).
    const post = fromZonedFields(2026, 9, 26, 18, 0, MADRID);
    expect(pre.toISOString()).toBe('2026-10-24T16:00:00.000Z');
    expect(post.toISOString()).toBe('2026-10-26T17:00:00.000Z');
  });
});

describe('zonedIsoWeekday', () => {
  it('devuelve 0 para un lunes en Madrid (2026-05-25 fue lunes)', () => {
    const d = new Date('2026-05-25T16:00:00Z'); // lunes 18:00 Madrid
    expect(zonedIsoWeekday(d, MADRID)).toBe(0);
  });

  it('devuelve 6 para un domingo en Madrid', () => {
    const d = new Date('2026-05-24T16:00:00Z'); // domingo 18:00 Madrid
    expect(zonedIsoWeekday(d, MADRID)).toBe(6);
  });
});
