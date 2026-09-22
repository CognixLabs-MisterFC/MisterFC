import { describe, expect, it } from 'vitest';
import {
  childrenNeedingConsent,
  hasSelfInvitation,
  isSelfInvitation,
  needsTutorConsent,
} from '../self';

/** Invitación de tutor: la que convierte a quien acepta en responsable del menor. */
const row = (player_id: string | null, player_relation: string | null) => ({
  role: player_id === null && player_relation === null ? 'entrenador_ayudante' : 'jugador',
  player_id,
  player_relation,
});

/** Invitación de SEGUIDOR: lleva jugador, pero NUNCA relación (lo fija el CHECK). */
const seguidor = (player_id: string) => ({
  role: 'spectator',
  player_id,
  player_relation: null,
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

describe('la abuela seguidora no responde por el nieto', () => {
  // La invitación de seguidor lleva player_id y NO lleva relación. Un filtro que
  // solo mirase `self` la daba por buena y le pintaba al abuelo la ficha del menor
  // —nombre y fecha de nacimiento— pidiéndole las decisiones de imagen del tutor.
  it('la de seguidor no pide tarjeta de hijo aunque lleve jugador', () => {
    expect(seguidor('p1').player_id).not.toBeNull();
    expect(isSelfInvitation(seguidor('p1'))).toBe(false);
    expect(childrenNeedingConsent([seguidor('p1')])).toEqual([]);
  });

  // El caso real: la abuela sigue a un nieto y es tutora de otro. Se le pide por
  // la que la hace tutora, y solo por esa.
  it('en un lote mixto deja la de tutor y quita la de seguidor', () => {
    const nieta = row('p1', 'guardian');
    expect(childrenNeedingConsent([seguidor('p2'), nieta])).toEqual([nieta]);
  });

  it('needsTutorConsent es el espejo de la condición de la RPC', () => {
    // role='jugador' + player_id + relación distinta de 'self'
    expect(needsTutorConsent(row('p1', 'parent'))).toBe(true);
    expect(needsTutorConsent(row('p1', 'guardian'))).toBe(true);
    // ...y ninguna otra combinación que la constraint permita guardar.
    expect(needsTutorConsent(row('p1', 'self'))).toBe(false);
    expect(needsTutorConsent(seguidor('p1'))).toBe(false);
    expect(needsTutorConsent(row(null, null))).toBe(false);
    expect(needsTutorConsent({ role: 'jugador', player_id: null, player_relation: null })).toBe(
      false,
    );
  });

  // Control negativo del propio test: sin el filtro por rol, la fila del seguidor
  // pasaba. Si alguien vuelve a quitarlo, este test es el que lo caza.
  it('el filtro que decide es el ROL, no la ausencia de relación', () => {
    const viejoFiltro = (r: { player_id: string | null; player_relation: string | null }) =>
      r.player_id != null && r.player_relation !== 'self';
    expect(viejoFiltro(seguidor('p1'))).toBe(true);
    expect(needsTutorConsent(seguidor('p1'))).toBe(false);
  });
});
