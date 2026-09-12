import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SU-4 — CANDADO de los textos de la suscripción en los tres idiomas.
 *
 * Dos cosas distintas se protegen aquí:
 *
 *  1. `account_deletion.subscription_note` estuvo VACÍA a propósito desde BC-4 —no
 *     había suscripción y no se iba a afirmar algo falso— y las dos tarjetas de borrado
 *     (web y nativa) la leen con un `.trim()` y la ocultan si está vacía. Es decir: si
 *     se queda vacía, el aviso **no aparece y nada falla**. Y ese aviso lo exige Apple:
 *     borrar la cuenta no cancela la suscripción. Un texto que desaparece en silencio
 *     es justo lo que hay que vigilar.
 *
 *  2. Las claves del muro de pago tienen que existir en los TRES idiomas. Una clave que
 *     falta se pinta como su propio nombre, y el usuario lee `subscription.subscribe`
 *     en el botón de pagar.
 */
const LOCALES = ['es', 'en', 'va'] as const;

/** Los catálogos viven en la raíz del repo; vitest corre en `packages/core`. */
function loadMessages(locale: string): Record<string, unknown> {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, `messages/${locale}.json`);
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro messages/${locale}.json subiendo desde ${process.cwd()}`);
}

function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

/** Las claves que usa la pantalla del muro (`paywall.tsx`). */
const PAYWALL_KEYS = [
  'subscription.title',
  'subscription.body',
  'subscription.per_year',
  'subscription.subscribe',
  'subscription.restore',
  'subscription.restore_none',
  'subscription.activating',
  'subscription.activating_slow',
  'subscription.billing_issue',
  'subscription.unavailable_platform',
  'subscription.retry',
  'subscription.offline',
  'subscription.terms_note',
  'subscription.errors.offering',
  'subscription.errors.purchase',
  'subscription.errors.restore',
  'subscription.errors.status',
];

describe.each(LOCALES)('catálogo %s', (locale) => {
  const messages = loadMessages(locale);

  it('el aviso de que borrar la cuenta NO cancela la suscripción ya no está vacío', () => {
    const note = get(messages, 'account_deletion.subscription_note');
    expect(typeof note).toBe('string');
    expect((note as string).trim().length).toBeGreaterThan(0);
  });

  // Apple pide decir dónde se gestiona, no solo que no se cancela.
  it('el aviso dice dónde cancelarla', () => {
    const note = String(get(messages, 'account_deletion.subscription_note')).toLowerCase();
    expect(note).toMatch(/suscripcion|subscription|subscripcion/i);
    expect(note).toMatch(/google play/i);
  });

  it.each(PAYWALL_KEYS)('%s existe y no está vacía', (key) => {
    const value = get(messages, key);
    expect(typeof value, `${key} falta en ${locale}`).toBe('string');
    expect((value as string).trim().length, `${key} vacía en ${locale}`).toBeGreaterThan(0);
  });
});

describe('los tres catálogos van a la par', () => {
  it('el bloque subscription tiene las mismas claves en es/en/va', () => {
    const flat = (o: unknown, p = ''): string[] =>
      o && typeof o === 'object'
        ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
            v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`],
          )
        : [];
    const [es, en, va] = LOCALES.map((l) => flat(get(loadMessages(l), 'subscription')).sort());
    expect(en).toEqual(es);
    expect(va).toEqual(es);
  });
});
