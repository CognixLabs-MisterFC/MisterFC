import { afterEach, describe, expect, it } from 'vitest';
import { LEGAL_FALLBACK_BASE, legalBaseUrl, legalUrl } from './legal-links';

/**
 * SU-7 — las URL de los documentos legales del muro de pago.
 *
 * Lo que se vigila: que NUNCA salga un enlace roto de aquí. Un enlace vacío o con
 * `/undefined/` en la pantalla de la compra es un rechazo por Guideline 3.1.2, y es de
 * los fallos que solo se ven cuando ya lo ha visto el revisor.
 */
const ORIGINAL = process.env.EXPO_PUBLIC_WEB_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_WEB_URL;
  else process.env.EXPO_PUBLIC_WEB_URL = ORIGINAL;
});

describe('legalUrl', () => {
  it('usa el dominio configurado en el build', () => {
    process.env.EXPO_PUBLIC_WEB_URL = 'https://misterfc.es';
    expect(legalUrl('terminos', 'es')).toBe('https://misterfc.es/es/legal/terminos');
    expect(legalUrl('privacidad', 'va')).toBe('https://misterfc.es/va/legal/privacidad');
  });

  it('aguanta una barra final en la variable', () => {
    process.env.EXPO_PUBLIC_WEB_URL = 'https://misterfc.es///';
    expect(legalUrl('terminos', 'en')).toBe('https://misterfc.es/en/legal/terminos');
  });

  // Al contrario que `callServerEndpoint`, aquí sí hay host por defecto: es un GET
  // anónimo a una página pública, y un enlace roto en la pantalla de pago cuesta la
  // revisión.
  it('sin variable en el build, cae al dominio de producción y NO a una cadena vacía', () => {
    delete process.env.EXPO_PUBLIC_WEB_URL;
    expect(legalBaseUrl()).toBe(LEGAL_FALLBACK_BASE);
    expect(legalUrl('privacidad', 'es')).toBe('https://misterfc.es/es/legal/privacidad');
  });

  it('con la variable vacía tampoco deja una URL sin host', () => {
    process.env.EXPO_PUBLIC_WEB_URL = '';
    expect(legalUrl('terminos', 'es').startsWith('https://')).toBe(true);
  });

  it('el dominio por defecto es https y sin barra final', () => {
    expect(LEGAL_FALLBACK_BASE).toMatch(/^https:\/\/[^/]+$/);
  });
});
