import { describe, it, expect } from 'vitest';
import {
  computeEndsAt,
  computeCitacionAt,
  DEFAULT_CITACION_LEAD_MINUTES,
} from '../match-duration';

describe('computeEndsAt', () => {
  it('half=30 → ends_at = starts_at + 60 min', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeEndsAt(start, 30)).toBe('2026-05-31T17:00:00.000Z');
  });

  it('half=45 → ends_at = starts_at + 90 min', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeEndsAt(start, 45)).toBe('2026-05-31T17:30:00.000Z');
  });

  it('half=20 (prebenjamín) → ends_at = starts_at + 40 min', () => {
    const start = '2026-04-12T10:00:00.000Z';
    expect(computeEndsAt(start, 20)).toBe('2026-04-12T10:40:00.000Z');
  });

  it('half=15 (querubín) → ends_at = starts_at + 30 min', () => {
    const start = '2026-04-12T10:00:00.000Z';
    expect(computeEndsAt(start, 15)).toBe('2026-04-12T10:30:00.000Z');
  });

  it('atraviesa medianoche correctamente', () => {
    const start = '2026-05-31T22:30:00.000Z';
    // 22:30 + 90 = 24:00 = next day 00:00 UTC
    expect(computeEndsAt(start, 45)).toBe('2026-06-01T00:00:00.000Z');
  });

  it('starts_at vacío/null → null', () => {
    expect(computeEndsAt(null, 45)).toBeNull();
    expect(computeEndsAt(undefined, 45)).toBeNull();
    expect(computeEndsAt('', 45)).toBeNull();
  });

  it('halfDuration 0/negativo/null → null (no sabemos)', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeEndsAt(start, 0)).toBeNull();
    expect(computeEndsAt(start, -10)).toBeNull();
    expect(computeEndsAt(start, null)).toBeNull();
    expect(computeEndsAt(start, undefined)).toBeNull();
  });

  it('starts_at inválido → null', () => {
    expect(computeEndsAt('not-an-iso', 45)).toBeNull();
  });
});

describe('computeCitacionAt', () => {
  it('default 60 min antes', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start)).toBe('2026-05-31T15:00:00.000Z');
  });

  it('lead custom 120 min', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start, 120)).toBe('2026-05-31T14:00:00.000Z');
  });

  it('lead = 0 → misma hora que kickoff', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start, 0)).toBe('2026-05-31T16:00:00.000Z');
  });

  it('lead negativo se clampa a 0 (no avanza al futuro)', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start, -30)).toBe('2026-05-31T16:00:00.000Z');
  });

  it('atraviesa medianoche correctamente (citacion del día anterior)', () => {
    const start = '2026-06-01T00:30:00.000Z';
    expect(computeCitacionAt(start, 60)).toBe('2026-05-31T23:30:00.000Z');
  });

  it('starts_at vacío/null → null', () => {
    expect(computeCitacionAt(null)).toBeNull();
    expect(computeCitacionAt(undefined)).toBeNull();
    expect(computeCitacionAt('')).toBeNull();
  });

  it('starts_at inválido → null', () => {
    expect(computeCitacionAt('not-an-iso')).toBeNull();
  });

  it('DEFAULT_CITACION_LEAD_MINUTES = 60', () => {
    expect(DEFAULT_CITACION_LEAD_MINUTES).toBe(60);
  });
});
