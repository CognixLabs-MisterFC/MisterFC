import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { revokeEffectKey } from './rows';

/**
 * CENSO DE TRADUCCIONES de la tarjeta de consentimientos.
 *
 * Existe porque dos de las claves se COMPONEN en tiempo de ejecución —`errors.<motivo>`
 * y `revoke_effect.<tipo>`— y una clave compuesta que no existe NO rompe: el hook pinta
 * la clave tal cual. O sea que el síntoma de una traducción olvidada es que un tutor lee
 * `consentimientos.errors.no_active_season` en la pantalla donde decide sobre los datos
 * de salud de su hijo. Es el fallo de R-4, y aquí no se repite.
 *
 * Las claves literales se leen DEL PROPIO FUENTE en vez de declararse a mano: una lista
 * escrita aquí envejece igual que el censo que este test existe para evitar.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const LOCALES = ['es', 'en', 'va'] as const;

function bloque(locale: string): Record<string, unknown> {
  const j = JSON.parse(readFileSync(join(RAIZ, 'messages', `${locale}.json`), 'utf8'));
  return j.consentimientos;
}

function tiene(obj: Record<string, unknown>, ruta: string): boolean {
  return ruta.split('.').reduce<unknown>((o, k) => {
    return o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
  }, obj) !== undefined;
}

/**
 * Los SEIS motivos de `RevokeConsentResult`, escritos a mano y comparados contra el
 * fuente de core. Si alguien añade un motivo nuevo allí y no lo traduce, salta aquí.
 */
const MOTIVOS = [
  'forbidden',
  'no_session',
  'not_revocable',
  'nothing_to_revoke',
  'no_active_season',
  'error',
];

const RETIRABLES = ['image_internal', 'image_social', 'medical_data_processing'];

function clavesUsadas(): string[] {
  const src = readFileSync(join(__dirname, '..', 'ui', 'consents-card.tsx'), 'utf8');
  const literales = [...src.matchAll(/\bt\('([a-z_]+(?:\.[a-z_]+)*)'\)/g)].map((m) => m[1]);
  expect(literales.length).toBeGreaterThan(0);
  const compuestas = [
    ...MOTIVOS.map((m) => `errors.${m}`),
    ...RETIRABLES.map((t) => revokeEffectKey(t)).filter((k): k is string => k !== null),
  ];
  return [...new Set([...literales, ...compuestas])];
}

describe('censo de traducciones de consentimientos', () => {
  it.each(LOCALES)('%s tiene todas las claves que la tarjeta pide', (loc) => {
    const b = bloque(loc);
    expect(b).toBeTruthy();
    const faltan = clavesUsadas().filter((k) => !tiene(b, k));
    expect(faltan).toEqual([]);
  });

  it('los tres idiomas tienen exactamente las mismas claves', () => {
    const planas = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' ? planas(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
      );
    const [es, en, va] = LOCALES.map((l) => planas(bloque(l)).sort());
    expect(en).toEqual(es);
    expect(va).toEqual(es);
  });

  // Los motivos que traducimos tienen que ser los que core puede devolver de verdad.
  it('los motivos del censo son los que declara core', () => {
    const src = readFileSync(
      join(RAIZ, 'packages', 'core', 'src', 'consents', 'actions.ts'),
      'utf8',
    );
    const bloqueTipo = src.slice(src.indexOf('reason:'), src.indexOf('export async function'));
    const declarados = [...bloqueTipo.matchAll(/^\s*\|\s*'([a-z_]+)'/gm)].map((m) => m[1]);
    expect(declarados.length).toBeGreaterThan(0);
    expect([...declarados].sort()).toEqual([...MOTIVOS].sort());
  });
});
