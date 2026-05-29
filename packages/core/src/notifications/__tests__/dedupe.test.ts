import { describe, expect, it } from 'vitest';
import {
  buildDedupeKey,
  dayBucketMadrid,
  parseDedupeKey,
} from '../dedupe';

const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

describe('buildDedupeKey', () => {
  it('compone una clave con los 5 segmentos esperados', () => {
    const key = buildDedupeKey({
      type: 'match_callup_reminder',
      channel: 'in_app',
      event_id: eventId,
      day_bucket: '2026-05-30',
      user_id: userId,
    });
    expect(key).toBe(
      `match_callup_reminder:in_app:${eventId}:2026-05-30:${userId}`
    );
  });

  it('produce claves distintas si cambian día, canal, type, event o user', () => {
    const base = {
      type: 'match_callup_reminder' as const,
      channel: 'in_app' as const,
      event_id: eventId,
      day_bucket: '2026-05-30',
      user_id: userId,
    };
    const a = buildDedupeKey(base);
    const b = buildDedupeKey({ ...base, day_bucket: '2026-05-31' });
    const c = buildDedupeKey({ ...base, channel: 'push' });
    const d = buildDedupeKey({ ...base, type: 'attendance_pending_reminder' });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('produce la MISMA clave dos veces para los mismos inputs (idempotencia)', () => {
    const args = {
      type: 'attendance_pending_reminder' as const,
      channel: 'in_app' as const,
      event_id: eventId,
      day_bucket: '2026-05-30',
      user_id: userId,
    };
    expect(buildDedupeKey(args)).toBe(buildDedupeKey(args));
  });

  it('rechaza event_id que no es UUID v4 estricto', () => {
    expect(() =>
      buildDedupeKey({
        type: 'match_callup_reminder',
        channel: 'in_app',
        event_id: 'not-a-uuid',
        day_bucket: '2026-05-30',
        user_id: userId,
      })
    ).toThrowError(/event_id_invalid/);
  });

  it('rechaza user_id que no es UUID v4 estricto', () => {
    expect(() =>
      buildDedupeKey({
        type: 'match_callup_reminder',
        channel: 'in_app',
        event_id: eventId,
        day_bucket: '2026-05-30',
        user_id: 'not-a-uuid',
      })
    ).toThrowError(/user_id_invalid/);
  });

  it('rechaza day_bucket sin formato YYYY-MM-DD', () => {
    expect(() =>
      buildDedupeKey({
        type: 'match_callup_reminder',
        channel: 'in_app',
        event_id: eventId,
        day_bucket: '30/05/2026',
        user_id: userId,
      })
    ).toThrowError(/day_bucket_invalid/);
  });
});

describe('parseDedupeKey', () => {
  it('parsea una clave bien formada', () => {
    const key = `match_callup_reminder:in_app:${eventId}:2026-05-30:${userId}`;
    expect(parseDedupeKey(key)).toEqual({
      type: 'match_callup_reminder',
      channel: 'in_app',
      event_id: eventId,
      day_bucket: '2026-05-30',
      user_id: userId,
    });
  });

  it('devuelve null si faltan segmentos', () => {
    expect(parseDedupeKey('a:b:c:d')).toBeNull();
    expect(parseDedupeKey('a:b:c:d:e:f')).toBeNull();
  });

  it('round-trip: build → parse devuelve los mismos campos', () => {
    const args = {
      type: 'attendance_pending_reminder' as const,
      channel: 'email' as const,
      event_id: eventId,
      day_bucket: '2026-06-01',
      user_id: userId,
    };
    const key = buildDedupeKey(args);
    const parsed = parseDedupeKey(key);
    expect(parsed).toEqual(args);
  });
});

describe('dayBucketMadrid', () => {
  it('produce un YYYY-MM-DD válido', () => {
    const out = dayBucketMadrid(new Date(Date.UTC(2026, 4, 30, 12, 0, 0)));
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('en invierno (UTC+1) una hora local cae en el día Madrid', () => {
    // 2026-01-15 12:00 UTC = 2026-01-15 13:00 Madrid (invierno).
    expect(
      dayBucketMadrid(new Date(Date.UTC(2026, 0, 15, 12, 0, 0)))
    ).toBe('2026-01-15');
  });

  it('en verano (UTC+2) 22:30 UTC del 14 cae en el 15 de Madrid', () => {
    // 2026-06-14 22:30 UTC = 2026-06-15 00:30 Madrid (verano).
    expect(
      dayBucketMadrid(new Date(Date.UTC(2026, 5, 14, 22, 30, 0)))
    ).toBe('2026-06-15');
  });

  it('medianoche UTC del 1-enero puede caer en el 31-diciembre o 1-enero según invierno', () => {
    // Madrid invierno (UTC+1) → 01:00 del mismo día. Bucket = 2026-01-01.
    expect(
      dayBucketMadrid(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))
    ).toBe('2026-01-01');
  });
});
