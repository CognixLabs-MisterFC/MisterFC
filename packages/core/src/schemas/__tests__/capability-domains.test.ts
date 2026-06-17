import { describe, it, expect } from 'vitest';
import { CAPABILITY_NAMES, CAPABILITY_DOMAINS } from '../staff';

describe('F11.9 — CAPABILITY_DOMAINS: agrupación de capabilities', () => {
  const grouped = CAPABILITY_DOMAINS.flatMap((d) => d.capabilities);

  it('cada capability aparece EXACTAMENTE una vez (sin duplicados)', () => {
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('cubre TODAS las CAPABILITY_NAMES y ninguna de más', () => {
    expect(new Set(grouped)).toEqual(new Set(CAPABILITY_NAMES));
    expect(grouped.length).toBe(CAPABILITY_NAMES.length);
  });

  it('claves de dominio únicas', () => {
    const keys = CAPABILITY_DOMAINS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
