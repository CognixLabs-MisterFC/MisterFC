import { describe, it, expect } from 'vitest';
import { mapHeaders } from '../parse';
import { playerImportRowSchema } from '../schema';

/**
 * O2-12a · Importador multiidioma. El parser acepta las 4 cabeceras del
 * template y los valores de posición/pie en español, inglés y valenciano.
 * Las cabeceras españolas antiguas deben seguir mapeando (no regresión).
 *
 * Cabeceras probadas tal como salen del template descargable de cada idioma,
 * con el "*" de obligatorio que `foldHeader` debe quitar antes del lookup.
 */

type Lang = 'es' | 'en' | 'va';

const BASE = {
  first_name: 'Pepe Gómez García',
  date_of_birth: '15/03/2010',
  invite_email: 'familia@example.com',
};

// header raw → columna canónica esperada, por idioma (los 4 del template).
const TEMPLATE_HEADERS: Record<Lang, Array<[string, string]>> = {
  es: [
    ['Nombre completo*', 'first_name'],
    ['Fecha de nacimiento*', 'date_of_birth'],
    ['Equipo', 'team'],
    ['Email*', 'invite_email'],
  ],
  en: [
    ['Full name*', 'first_name'],
    ['Date of birth*', 'date_of_birth'],
    ['Team', 'team'],
    ['Email*', 'invite_email'],
  ],
  va: [
    ['Nom complet*', 'first_name'],
    ['Data de naixement*', 'date_of_birth'],
    ['Equip', 'team'],
    ['Email*', 'invite_email'],
  ],
};

// una posición + un pie por idioma (EN/VA usan términos NUEVOS de esta tanda).
const POSITION_SAMPLES: Record<Lang, [string, string]> = {
  es: ['Extremo', 'forward'],
  en: ['Full-back', 'defender'],
  va: ['Migcampista', 'midfielder'],
};
const FOOT_SAMPLES: Record<Lang, [string, string]> = {
  es: ['Ambidiestro', 'both'],
  en: ['Two-footed', 'both'],
  va: ['Esquerre', 'left'],
};

for (const lang of ['es', 'en', 'va'] as const) {
  describe(`importador · ${lang}`, () => {
    it('mapea las 4 cabeceras del template a columnas canónicas', () => {
      const rawHeaders = TEMPLATE_HEADERS[lang].map(([h]) => h);
      const { mapping, unmapped } = mapHeaders(rawHeaders);
      expect(unmapped).toEqual([]);
      for (const [header, canonical] of TEMPLATE_HEADERS[lang]) {
        expect(mapping.get(header)).toBe(canonical);
      }
    });

    it('acepta una posición del idioma', () => {
      const [value, canonical] = POSITION_SAMPLES[lang];
      const parsed = playerImportRowSchema.safeParse({
        ...BASE,
        position_main: value,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.position_main).toBe(canonical);
    });

    it('acepta un pie del idioma', () => {
      const [value, canonical] = FOOT_SAMPLES[lang];
      const parsed = playerImportRowSchema.safeParse({ ...BASE, foot: value });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.foot).toBe(canonical);
    });
  });
}

describe('no regresión — cabeceras españolas antiguas', () => {
  it('las cabeceras clásicas ES siguen mapeando', () => {
    const { mapping, unmapped } = mapHeaders([
      'Nombre completo*',
      'Fecha de nacimiento*',
      'Equipo',
      'Email*',
      'Apellidos',
      'Dorsal',
      'Posición',
      'Pie dominante',
    ]);
    expect(unmapped).toEqual([]);
    expect(mapping.get('Apellidos')).toBe('last_name');
    expect(mapping.get('Dorsal')).toBe('dorsal');
    expect(mapping.get('Posición')).toBe('position_main');
    expect(mapping.get('Pie dominante')).toBe('foot');
  });

  it('los valores ES clásicos de posición/pie siguen resolviendo', () => {
    const pos = playerImportRowSchema.safeParse({
      ...BASE,
      position_main: 'Portero',
      foot: 'Diestro',
    });
    expect(pos.success).toBe(true);
    if (pos.success) {
      expect(pos.data.position_main).toBe('goalkeeper');
      expect(pos.data.foot).toBe('right');
    }
  });
});
