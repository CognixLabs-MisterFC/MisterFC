import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../../../../../apps/web/src/lib/security-headers';

/**
 * Las cabeceras de seguridad básicas de misterfc.es (`apps/web/src/lib/security-headers.ts`)
 * y que `next.config.ts` las pone en todas las rutas. Que de verdad salgan en las
 * respuestas se comprobó contra el servidor al hacer el PR; esto vigila que nadie las
 * afloje ni las desenchufe sin querer.
 */
const porNombre = new Map(SECURITY_HEADERS.map((h) => [h.key.toLowerCase(), h.value]));

describe('cabeceras de seguridad básicas', () => {
  it('premisa: hay cabeceras', () => {
    expect(SECURITY_HEADERS.length).toBeGreaterThan(0);
  });

  it.each([
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['x-frame-options', 'DENY'],
  ])('%s: %s', (key, value) => {
    expect(porNombre.get(key)).toBe(value);
  });

  it('Permissions-Policy apaga cámara, micrófono y ubicación', () => {
    const politica = porNombre.get('permissions-policy') ?? '';
    for (const p of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(politica).toContain(p);
    }
  });

  it('no repite Strict-Transport-Security, que ya pone Vercel', () => {
    expect(porNombre.has('strict-transport-security')).toBe(false);
  });

  it('next.config.ts las aplica a todas las rutas', () => {
    const config = readFileSync(
      fileURLToPath(new URL('../../../../../apps/web/next.config.ts', import.meta.url)),
      'utf8',
    );
    expect(config).toMatch(/async headers\(\)[\s\S]*source: '\/:path\*'[\s\S]*SECURITY_HEADERS/);
  });
});
