import { describe, expect, it } from 'vitest';
import {
  childrenNeedingConsent,
  hasSelfInvitation,
  isSelfInvitation,
} from '../self';

const row = (player_id: string | null, player_relation: string | null) => ({
  player_id,
  player_relation,
});

describe('MN-5 · la invitación de cuenta propia en el alta', () => {
  it('reconoce la invitación self y no confunde las de tutor', () => {
    expect(isSelfInvitation(row('p1', 'self'))).toBe(true);
    expect(isSelfInvitation(row('p1', 'parent'))).toBe(false);
    expect(isSelfInvitation(row('p1', 'guardian'))).toBe(false);
  });

  it('una invitación sin relación (staff) no es self', () => {
    expect(isSelfInvitation(row(null, null))).toBe(false);
  });

  it('la cuenta propia NO pide tarjeta de hijo', () => {
    expect(childrenNeedingConsent([row('p1', 'self')])).toEqual([]);
  });

  it('las de tutor sí la piden', () => {
    const rows = [row('p1', 'parent'), row('p2', 'guardian')];
    expect(childrenNeedingConsent(rows)).toEqual(rows);
  });

  // El caso que obliga a filtrar fila a fila y no por lote: un padre que es tutor
  // de su hija Y jugador adulto de su propia ficha, las dos en el mismo correo.
  it('en un lote mixto deja las de tutor y quita la propia', () => {
    const hija = row('p1', 'parent');
    const propia = row('p2', 'self');
    expect(childrenNeedingConsent([hija, propia])).toEqual([hija]);
    expect(hasSelfInvitation([hija, propia])).toBe(true);
  });

  it('descarta las invitaciones sin jugador, que no son de nadie', () => {
    expect(childrenNeedingConsent([row(null, null), row('p1', 'parent')])).toEqual([
      row('p1', 'parent'),
    ]);
  });

  it('hasSelfInvitation es falso en un lote solo de tutores', () => {
    expect(hasSelfInvitation([row('p1', 'parent'), row('p2', 'guardian')])).toBe(false);
  });

  // No normaliza ni adivina: 'SELF' no es 'self'. La columna la gobierna el CHECK
  // de la base de datos, que solo admite las tres en minúscula.
  it('no interpreta variantes que la base de datos no admite', () => {
    expect(isSelfInvitation(row('p1', 'SELF'))).toBe(false);
  });
});
