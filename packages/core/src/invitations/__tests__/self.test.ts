import { describe, expect, it } from 'vitest';
import {
  childrenNeedingConsent,
  hasSelfInvitation,
  isSelfInvitation,
  needsTutorConsent,
  tutorLinkPlayerIds,
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

describe('D-2 · a qué vínculos se les pega la declaración de mayoría de edad', () => {
  it('a los que este alta convierte en tutela, y por su player_id', () => {
    expect(tutorLinkPlayerIds([row('p1', 'parent'), row('p2', 'guardian')])).toEqual(['p1', 'p2']);
  });

  it('a ninguno si el alta no le hace tutor: no hay nada que declarar', () => {
    expect(tutorLinkPlayerIds([])).toEqual([]);
    expect(tutorLinkPlayerIds([row(null, null)])).toEqual([]);
    expect(tutorLinkPlayerIds([seguidor('p1')])).toEqual([]);
  });

  // El CHECK de la 20261109000000 rechaza una declaración en un `self`. Si esta lista lo
  // dejara pasar, el alta de la cuenta propia acabaría con un error registrado en cada
  // aceptación — y con el aviso de «declaración sin sellar» sonando para siempre.
  it('nunca a la cuenta propia del jugador, que es lo que el CHECK rechaza', () => {
    expect(tutorLinkPlayerIds([row('p1', 'self')])).toEqual([]);
    expect(tutorLinkPlayerIds([row('p1', 'self'), row('p2', 'parent')])).toEqual(['p2']);
  });

  it('sin repetidos: quien escribe compara cuántas filas esperaba', () => {
    // Dos invitaciones al mismo hijo en el mismo lote son UN vínculo, no dos. Con el
    // duplicado dentro, `esperados` valdría 2, el UPDATE anotaría 1 y el aviso de avería
    // saltaría en un alta perfectamente normal.
    expect(tutorLinkPlayerIds([row('p1', 'parent'), row('p1', 'guardian')])).toEqual(['p1']);
  });

  it('es la MISMA lista que decide si la casilla es obligatoria', () => {
    // La casilla se pide cuando childrenNeedingConsent no está vacío. Si estas dos se
    // separaran, habría altas que piden la declaración y no la guardan, o al revés.
    const lotes = [
      [row('p1', 'parent')],
      [row('p1', 'self')],
      [seguidor('p1')],
      [row(null, null)],
      [row('p1', 'self'), row('p2', 'guardian')],
      [],
    ];
    for (const lote of lotes) {
      expect(tutorLinkPlayerIds(lote).length > 0).toBe(childrenNeedingConsent(lote).length > 0);
    }
  });
});
