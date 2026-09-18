import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { consentTypeKey, grantEffectKey, revokeEffectKey } from './rows';

/**
 * CENSO DE TRADUCCIONES de la tarjeta de consentimientos.
 *
 * Existe porque varias claves se COMPONEN en tiempo de ejecución —`errors.<motivo>`,
 * `grant_errors.<motivo>`, `revoke_effect.<tipo>`, `grant_effect.<tipo>` y
 * `types.<tipo>`— y una clave compuesta que no existe NO rompe: el hook pinta la clave
 * tal cual. O sea que el síntoma de una traducción olvidada es que un tutor lee
 * `consentimientos.grant_errors.no_document` en la pantalla donde decide sobre los
 * datos de salud de su hijo. Es el fallo de R-4, y aquí no se repite.
 *
 * Las claves literales se leen DEL PROPIO FUENTE en vez de declararse a mano: una lista
 * escrita aquí envejece igual que el censo que este test existe para evitar.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const LOCALES = ['es', 'en', 'va'] as const;

const FUENTE_ACTIONS = join(RAIZ, 'packages', 'core', 'src', 'consents', 'actions.ts');

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
 * Los motivos de cada operación, escritos a mano y comparados contra el fuente de core.
 * Si alguien añade un motivo nuevo allí y no lo traduce, salta aquí.
 */
const MOTIVOS_RETIRAR = [
  'forbidden',
  'no_session',
  'not_revocable',
  'nothing_to_revoke',
  'no_active_season',
  'error',
];

const MOTIVOS_CONCEDER = [
  'forbidden',
  'no_session',
  'not_grantable',
  'no_document',
  'document_changed',
  'no_active_season',
  'error',
];

const OPCIONALES = ['image_internal', 'image_social', 'medical_data_processing'];

/** Los motivos que declara un tipo de resultado de core, leídos del fuente. */
function motivosDeclarados(nombreDelTipo: string): string[] {
  const src = readFileSync(FUENTE_ACTIONS, 'utf8');
  const i = src.indexOf(`export type ${nombreDelTipo} =`);
  expect(i).toBeGreaterThan(-1);
  const fin = src.indexOf('export async function', i);
  expect(fin).toBeGreaterThan(i);
  return [...src.slice(i, fin).matchAll(/^\s*\|\s*'([a-z_]+)'/gm)].map((m) => m[1]);
}

function clavesUsadas(): string[] {
  const src = readFileSync(join(__dirname, '..', 'ui', 'consents-card.tsx'), 'utf8');
  const literales = [...src.matchAll(/\bt\('([a-z_]+(?:\.[a-z_]+)*)'\)/g)].map((m) => m[1]);
  expect(literales.length).toBeGreaterThan(0);
  const compuestas = [
    ...MOTIVOS_RETIRAR.map((m) => `errors.${m}`),
    ...MOTIVOS_CONCEDER.map((m) => `grant_errors.${m}`),
    ...OPCIONALES.map((t) => revokeEffectKey(t)).filter((k): k is string => k !== null),
    ...OPCIONALES.map((t) => grantEffectKey(t)).filter((k): k is string => k !== null),
    ...OPCIONALES.map((t) => consentTypeKey(t)),
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
  it('los motivos de la retirada son los que declara core', () => {
    const declarados = motivosDeclarados('RevokeConsentResult');
    expect(declarados.length).toBeGreaterThan(0);
    expect([...declarados].sort()).toEqual([...MOTIVOS_RETIRAR].sort());
  });

  it('los motivos de la concesión son los que declara core', () => {
    const declarados = motivosDeclarados('GrantConsentResult');
    expect(declarados.length).toBeGreaterThan(0);
    expect([...declarados].sort()).toEqual([...MOTIVOS_CONCEDER].sort());
  });

  /**
   * Y el texto de retirar no puede seguir mandando esperar al club: mientras solo se
   * podía retirar, `revoke_note` decía «puedes volver a darlo cuando el club te pida
   * revisar los permisos», que era verdad y dejó de serlo el día que se pudo conceder
   * desde la propia pantalla. Un texto legal obsoleto no da ningún error.
   */
  it.each(LOCALES)('%s: el aviso de retirar no manda esperar al club', (loc) => {
    const b = bloque(loc) as { revoke_note: string };
    expect(b.revoke_note).toBeTruthy();
    expect(b.revoke_note.toLowerCase()).not.toMatch(/club/);
  });
});
