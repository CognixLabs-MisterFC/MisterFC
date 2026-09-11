import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationFeedText } from '../feed-text';

/**
 * `t` de mentira: devuelve la CLAVE y los valores interpolados, para poder afirmar
 * QUÉ clave se eligió sin acoplarse al copy de `messages/*.json`.
 */
const t = (key: string, values?: Record<string, string>) =>
  values ? `${key}(${JSON.stringify(values)})` : key;

const text = (type: string, payload: unknown) => notificationFeedText(t, type, payload);

describe('account_deletion_requested', () => {
  it('sin equipos → texto genérico de miembro del club', () => {
    expect(text('account_deletion_requested', { club_id: 'c1', teams: [] })).toBe(
      'account_deletion_requested',
    );
  });

  it('con equipos → dice CUÁLES deja sin cubrir (es lo accionable para el club)', () => {
    expect(text('account_deletion_requested', { teams: ['Alevín A', 'Benjamín B'] })).toBe(
      'account_deletion_requested_coach({"teams":"Alevín A, Benjamín B"})',
    );
  });

  it('is_platform gana sobre los equipos: al superadmin le importa el club sin admin', () => {
    expect(
      text('account_deletion_requested', {
        is_platform: true,
        club_name: 'CD Ejemplo',
        teams: ['Alevín A'],
      }),
    ).toBe('account_deletion_requested_admin_named({"club":"CD Ejemplo"})');
  });

  it('is_platform sin club_name → variante sin nombre', () => {
    expect(text('account_deletion_requested', { is_platform: true })).toBe(
      'account_deletion_requested_admin',
    );
  });

  it('NUNCA pinta el nombre de quien se borra, ni aunque el payload lo trajera', () => {
    // El payload no lo lleva (BC-7a: payload es inmutable, un nombre ahí no se podría
    // limpiar al anonimizar). Este test es el candado por si alguien lo añadiera.
    const out = text('account_deletion_requested', { name: 'Tomás Tutor', teams: [] });
    expect(out).not.toContain('Tomás');
  });

  it('`teams` con basura dentro no rompe: se ignora lo que no sea string', () => {
    expect(text('account_deletion_requested', { teams: [null, 42, 'Cadete A', ''] })).toBe(
      'account_deletion_requested_coach({"teams":"Cadete A"})',
    );
  });

  it('`teams` que no es lista → genérico, sin reventar', () => {
    expect(text('account_deletion_requested', { teams: 'Alevín A' })).toBe(
      'account_deletion_requested',
    );
  });
});

describe('account_deletion_completed', () => {
  it('con el nombre del club', () => {
    expect(text('account_deletion_completed', { club_name: 'CD Ejemplo' })).toBe(
      'account_deletion_completed_named({"club":"CD Ejemplo"})',
    );
  });

  it('sin nombre → genérico', () => {
    expect(text('account_deletion_completed', { club_id: 'c1' })).toBe(
      'account_deletion_completed',
    );
  });
});

describe('tutor_unlinked', () => {
  it('nombra al MENOR: quien lo lee es su propio tutor', () => {
    expect(text('tutor_unlinked', { player_first_name: 'Nil' })).toBe(
      'tutor_unlinked_named({"name":"Nil"})',
    );
  });

  it('sin nombre del menor → genérico', () => {
    expect(text('tutor_unlinked', { player_id: 'p1' })).toBe('tutor_unlinked');
  });

  it('payload nulo o basura → genérico, nunca una excepción', () => {
    expect(text('tutor_unlinked', null)).toBe('tutor_unlinked');
    expect(text('tutor_unlinked', 'no soy un objeto')).toBe('tutor_unlinked');
  });
});

/**
 * Candado contra la clave fantasma: `t` es una función, así que un typo en una clave
 * no rompe nada aquí — pero en el feed real next-intl pinta la clave cruda. Se buscan
 * los catálogos subiendo desde el cwd (vitest corre en `packages/core`) para no
 * depender de cuántos niveles hay hasta la raíz.
 */
function repoMessages(locale: string): Record<string, unknown> {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'messages', `${locale}.json`);
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro messages/${locale}.json subiendo desde ${process.cwd()}`);
}

describe('las claves existen de verdad en los tres catálogos', () => {
  const used = [
    'account_deletion_requested',
    'account_deletion_requested_coach',
    'account_deletion_requested_admin',
    'account_deletion_requested_admin_named',
    'account_deletion_completed',
    'account_deletion_completed_named',
    'tutor_unlinked',
    'tutor_unlinked_named',
  ];

  for (const locale of ['es', 'en', 'va']) {
    it(`${locale}: home.feed tiene las 8 claves de BC-7`, () => {
      const msgs = repoMessages(locale) as { home: { feed: Record<string, string> } };
      for (const key of used) {
        expect(typeof msgs.home.feed[key], `falta home.feed.${key} en ${locale}`).toBe('string');
      }
    });
  }

  it('las variantes con placeholder lo llevan de verdad', () => {
    const feed = (repoMessages('es') as { home: { feed: Record<string, string> } }).home.feed;
    expect(feed.account_deletion_requested_coach).toContain('{teams}');
    expect(feed.account_deletion_requested_admin_named).toContain('{club}');
    expect(feed.account_deletion_completed_named).toContain('{club}');
    expect(feed.tutor_unlinked_named).toContain('{name}');
  });
});
