import { describe, it, expect } from 'vitest';
import {
  countOccurrences,
  expandRecurrence,
  localDaysBetween,
} from '../recurrence';
import { TIMEZONE_OLA1 } from '../types';
import { zonedFields } from '../tz';

const TZ = TIMEZONE_OLA1; // Europe/Madrid

describe('expandRecurrence — casos básicos', () => {
  it('weekly interval=1, by_weekday=[1] (martes), count=4 genera 4 martes consecutivos', () => {
    // Parent: martes 12 mayo 2026 18:00 Madrid.
    const parent = new Date('2026-05-12T16:00:00Z');
    const out = expandRecurrence(
      parent,
      null,
      { freq: 'weekly', interval: 1, by_weekday: [1], count: 4 },
      TZ
    );
    expect(out).toHaveLength(4);
    expect(out[0]!.starts_at.toISOString()).toBe('2026-05-12T16:00:00.000Z');
    expect(out[1]!.starts_at.toISOString()).toBe('2026-05-19T16:00:00.000Z');
    expect(out[2]!.starts_at.toISOString()).toBe('2026-05-26T16:00:00.000Z');
    expect(out[3]!.starts_at.toISOString()).toBe('2026-06-02T16:00:00.000Z');
  });

  it('weekly interval=2, by_weekday=[2,4] (mié+vie) hasta until=date', () => {
    // Parent: miércoles 13 mayo 2026 19:00 Madrid (UTC+2).
    const parent = new Date('2026-05-13T17:00:00Z');
    const out = expandRecurrence(
      parent,
      null,
      {
        freq: 'weekly',
        interval: 2,
        by_weekday: [2, 4],
        until: '2026-06-12',
      },
      TZ
    );
    // Mié 13 may + Vie 15 may + (semana 14: 27 mié, 29 vie) + (semana 16: 10 jun, 12 jun)
    expect(out).toHaveLength(6);
    expect(out[0]!.starts_at.toISOString()).toBe('2026-05-13T17:00:00.000Z');
    expect(out[1]!.starts_at.toISOString()).toBe('2026-05-15T17:00:00.000Z');
    expect(out[5]!.starts_at.toISOString()).toBe('2026-06-12T17:00:00.000Z');
  });

  it('semana 0 parcial: parent miércoles con by_weekday=[Mon, Wed, Fri], count=4 → 4·3 - 1 = 11 ocurrencias', () => {
    const parent = new Date('2026-05-13T17:00:00Z'); // miércoles
    const out = expandRecurrence(
      parent,
      null,
      { freq: 'weekly', interval: 1, by_weekday: [0, 2, 4], count: 4 },
      TZ
    );
    expect(out).toHaveLength(11);
    expect(out[0]!.starts_at.toISOString()).toBe('2026-05-13T17:00:00.000Z'); // mié
    expect(out[1]!.starts_at.toISOString()).toBe('2026-05-15T17:00:00.000Z'); // vie
    expect(out[2]!.starts_at.toISOString()).toBe('2026-05-18T17:00:00.000Z'); // lun
  });

  it('preserva la duración del parent en cada hijo', () => {
    const parent = new Date('2026-05-12T16:00:00Z');
    const parentEnd = new Date('2026-05-12T17:30:00Z'); // 90 min
    const out = expandRecurrence(
      parent,
      parentEnd,
      { freq: 'weekly', interval: 1, by_weekday: [1], count: 3 },
      TZ
    );
    for (const occ of out) {
      const dur = occ.ends_at!.getTime() - occ.starts_at.getTime();
      expect(dur).toBe(90 * 60 * 1000);
    }
  });
});

describe('expandRecurrence — DST Madrid', () => {
  it('cruza la primavera (29 marzo 2026): 18:00 local en cada lado del cambio', () => {
    // Parent: domingo 22 mar 2026 18:00 Madrid (UTC+1 → UTC 17:00).
    const parent = new Date('2026-03-22T17:00:00Z');
    const out = expandRecurrence(
      parent,
      null,
      { freq: 'weekly', interval: 1, by_weekday: [6], count: 3 },
      TZ
    );
    expect(out[0]!.starts_at.toISOString()).toBe('2026-03-22T17:00:00.000Z');
    // 29 marzo (post cambio, UTC+2 → UTC 16:00).
    expect(out[1]!.starts_at.toISOString()).toBe('2026-03-29T16:00:00.000Z');
    expect(out[2]!.starts_at.toISOString()).toBe('2026-04-05T16:00:00.000Z');
    // Verifica que la hora local sigue siendo 18:00 en todas.
    for (const occ of out) {
      const f = zonedFields(occ.starts_at, TZ);
      expect(f.hour).toBe(18);
      expect(f.minute).toBe(0);
    }
  });

  it('cruza el otoño (25 octubre 2026): 18:00 local en cada lado del cambio', () => {
    // Parent: domingo 18 oct 2026 18:00 Madrid (CEST UTC+2 → UTC 16:00).
    const parent = new Date('2026-10-18T16:00:00Z');
    const out = expandRecurrence(
      parent,
      null,
      { freq: 'weekly', interval: 1, by_weekday: [6], count: 3 },
      TZ
    );
    expect(out[0]!.starts_at.toISOString()).toBe('2026-10-18T16:00:00.000Z');
    // 25 oct (cambio: a las 03:00 retrocede a 02:00). 18:00 local = CET → UTC 17:00.
    expect(out[1]!.starts_at.toISOString()).toBe('2026-10-25T17:00:00.000Z');
    expect(out[2]!.starts_at.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    for (const occ of out) {
      const f = zonedFields(occ.starts_at, TZ);
      expect(f.hour).toBe(18);
    }
  });
});

describe('expandRecurrence — límites y rechazos', () => {
  it('count XOR until: ambos definidos → rechaza', () => {
    const parent = new Date('2026-05-12T16:00:00Z');
    expect(() =>
      expandRecurrence(
        parent,
        null,
        {
          freq: 'weekly',
          interval: 1,
          by_weekday: [1],
          count: 4,
          until: '2026-06-30',
        },
        TZ
      )
    ).toThrow(/count_xor_until/);
  });

  it('count XOR until: ninguno definido → rechaza', () => {
    const parent = new Date('2026-05-12T16:00:00Z');
    expect(() =>
      expandRecurrence(
        parent,
        null,
        { freq: 'weekly', interval: 1, by_weekday: [1] },
        TZ
      )
    ).toThrow(/count_xor_until/);
  });

  it('by_weekday vacío → rechaza', () => {
    const parent = new Date('2026-05-12T16:00:00Z');
    expect(() =>
      expandRecurrence(
        parent,
        null,
        { freq: 'weekly', interval: 1, by_weekday: [], count: 1 },
        TZ
      )
    ).toThrow(/by_weekday_empty/);
  });

  it('interval fuera de [1,4] → rechaza', () => {
    const parent = new Date('2026-05-12T16:00:00Z');
    expect(() =>
      expandRecurrence(
        parent,
        null,
        { freq: 'weekly', interval: 5, by_weekday: [1], count: 4 },
        TZ
      )
    ).toThrow(/invalid_interval/);
  });

  it('count > 52 → rechaza (max 52 semanas)', () => {
    const parent = new Date('2026-05-12T16:00:00Z');
    expect(() =>
      expandRecurrence(
        parent,
        null,
        { freq: 'weekly', interval: 1, by_weekday: [1], count: 53 },
        TZ
      )
    ).toThrow(/count_out_of_range/);
  });
});

describe('expandRecurrence — caso real producto', () => {
  it('3 días/semana × 36 semanas = 108 ocurrencias', () => {
    // Parent: lunes 2 sep 2026 18:00 Madrid (CEST → UTC 16:00).
    const parent = new Date('2026-09-07T16:00:00Z'); // lunes 7 sep
    const out = expandRecurrence(
      parent,
      null,
      { freq: 'weekly', interval: 1, by_weekday: [0, 2, 4], count: 36 },
      TZ
    );
    expect(out.length).toBe(108);
  });
});

describe('countOccurrences', () => {
  it('coincide con expandRecurrence().length', () => {
    const parent = new Date('2026-05-12T16:00:00Z');
    const rule = {
      freq: 'weekly' as const,
      interval: 1,
      by_weekday: [1, 3],
      count: 10,
    };
    const count = countOccurrences(parent, rule, TZ);
    const full = expandRecurrence(parent, null, rule, TZ);
    expect(count).toBe(full.length);
  });
});

describe('localDaysBetween', () => {
  it('cuenta días entre dos fechas locales (Madrid)', () => {
    const a = new Date('2026-05-15T10:00:00Z'); // 12:00 Madrid
    const b = new Date('2026-05-20T10:00:00Z'); // 12:00 Madrid
    expect(localDaysBetween(a, b, TZ)).toBe(5);
  });

  it('cuenta cruzando DST primavera', () => {
    const a = new Date('2026-03-25T10:00:00Z'); // 11:00 Madrid (CET)
    const b = new Date('2026-04-01T08:00:00Z'); // 10:00 Madrid (CEST)
    expect(localDaysBetween(a, b, TZ)).toBe(7);
  });
});
