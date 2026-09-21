import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  playerInviteKind,
  type PlayerInviteKind,
} from '../player-invite-kind';

const row = (role: string | null, player_relation: string | null) => ({
  role,
  player_relation,
});

describe('la ficha del jugador distingue sus invitaciones pendientes', () => {
  // Las tres formas que el CHECK invitations_player_role_consistency admite con
  // player_id. Son las tres que se ven juntas en la tarjeta de Familia.
  it('reconoce al tutor, padre o legal', () => {
    expect(playerInviteKind(row('jugador', 'parent'))).toBe('parent');
    expect(playerInviteKind(row('jugador', 'guardian'))).toBe('guardian');
  });

  it('reconoce la cuenta del propio jugador', () => {
    expect(playerInviteKind(row('jugador', 'self'))).toBe('self');
  });

  // El caso que motivó la pieza: sin relación, la ficha no escribía nada.
  it('reconoce al seguidor, que no tiene relación', () => {
    expect(playerInviteKind(row('spectator', null))).toBe('spectator');
  });

  // Lo importante no es que el seguidor salga bien, sino que NADIE MÁS salga como
  // seguidor: la abuela y el padre se cancelan con el mismo botón.
  it('un tutor no se confunde nunca con un seguidor, ni al revés', () => {
    expect(playerInviteKind(row('spectator', 'parent'))).toBe('unknown');
    expect(playerInviteKind(row('jugador', null))).toBe('unknown');
  });

  it('no adivina relaciones que la base de datos no admite', () => {
    expect(playerInviteKind(row('jugador', 'SELF'))).toBe('unknown');
    expect(playerInviteKind(row('jugador', 'abuela'))).toBe('unknown');
  });

  it('una invitación de club que llegara aquí no se disfraza de familia', () => {
    expect(playerInviteKind(row('entrenador_principal', null))).toBe('unknown');
    expect(playerInviteKind(row(null, null))).toBe('unknown');
  });
});

/**
 * La clasificación solo sirve si cada clase tiene su texto. Un `kind` sin entrada
 * en el catálogo no da error de compilación: next-intl pinta la ruta de la clave
 * cruda —«family.invite_kind.spectator»— al lado del correo de la abuela. Esto lo
 * caza aquí, y en los tres idiomas, que es donde se olvida.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const LOCALES = ['es', 'en', 'va'] as const;
const KINDS: readonly PlayerInviteKind[] = [
  'parent',
  'guardian',
  'self',
  'spectator',
  'unknown',
];

describe('cada clase de invitación tiene texto en los tres idiomas', () => {
  it.each(LOCALES)('%s los tiene todos, y ninguno vacío', (loc) => {
    const cat = JSON.parse(
      readFileSync(join(RAIZ, 'messages', `${loc}.json`), 'utf8'),
    ) as Record<string, unknown>;
    const bloque = (
      (
        (cat.jugadores as Record<string, unknown> | undefined)?.family as
          | Record<string, unknown>
          | undefined
      )?.invite_kind ?? {}
    ) as Record<string, unknown>;

    // Ancla positiva: si la ruta cambiara, el bloque llegaría vacío y los
    // `toBe('')` de abajo pasarían por el motivo equivocado.
    expect(Object.keys(bloque).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      expect(typeof bloque[kind]).toBe('string');
      expect((bloque[kind] as string).trim()).not.toBe('');
    }
  });
});
