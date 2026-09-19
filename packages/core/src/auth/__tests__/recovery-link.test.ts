import { describe, it, expect } from 'vitest';
import { recoveryRedirectTo } from '../recovery-link';

describe('recoveryRedirectTo', () => {
  it('apunta a la pantalla, no al callback', () => {
    expect(recoveryRedirectTo('https://misterfc.es', 'es')).toBe(
      'https://misterfc.es/es/reset-password',
    );
  });

  it('respeta el locale', () => {
    expect(recoveryRedirectTo('https://misterfc.es', 'va')).toBe(
      'https://misterfc.es/va/reset-password',
    );
  });

  it('no duplica la barra si la base la trae', () => {
    expect(recoveryRedirectTo('https://misterfc.es///', 'en')).toBe(
      'https://misterfc.es/en/reset-password',
    );
  });

  // BUG-4: el rodeo por el callback es justo lo que rompía el flujo implícito.
  it('no lleva query: nada que perder por el camino', () => {
    const url = recoveryRedirectTo('http://localhost:3000', 'es');
    expect(url).not.toContain('?');
    expect(url).not.toContain('/auth/callback');
  });
});
