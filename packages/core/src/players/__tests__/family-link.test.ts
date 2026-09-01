import { describe, expect, it } from 'vitest';
import { hasLinkedFamily } from '../family-link';

describe('hasLinkedFamily', () => {
  it('true con al menos una cuenta, false sin cuentas', () => {
    expect(hasLinkedFamily([{ profile_id: 'a' }])).toBe(true);
    expect(hasLinkedFamily([{ profile_id: 'a' }, { profile_id: 'b' }])).toBe(true);
    expect(hasLinkedFamily([])).toBe(false);
    expect(hasLinkedFamily(null)).toBe(false);
    expect(hasLinkedFamily(undefined)).toBe(false);
  });
});
