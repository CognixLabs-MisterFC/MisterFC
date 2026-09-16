import { describe, expect, it } from 'vitest';
import { ALL_CLUB_ROLES, STAFF_ROLES } from '../../auth/roles';
import type { Role } from '../../auth/current-user';
import { requiresSubscription } from '../../subscription/rules';
import { isFamilyAccount, type AccountLinks } from '../rules';

const links = (o: Partial<AccountLinks> = {}): AccountLinks => ({
  isPlatformAdmin: false,
  activeRoles: [],
  isTutor: false,
  isSpectator: false,
  ...o,
});

describe('isFamilyAccount', () => {
  it('el tutor pasa a la app', () => {
    expect(isFamilyAccount(links({ isTutor: true }))).toBe(true);
  });

  // Decisión 1 de la ronda de respuestas: los seguidores DENTRO. La nativa tiene su
  // carcasa de seguidor completa (4 pestañas propias), así que no se quedan sin sitio.
  it('el seguidor también: Jose los metió dentro', () => {
    expect(isFamilyAccount(links({ isSpectator: true }))).toBe(true);
  });

  it('la cuenta familiar del club (rol jugador) pasa a la app', () => {
    expect(isFamilyAccount(links({ activeRoles: ['jugador'] }))).toBe(true);
  });

  it.each(STAFF_ROLES)('%s conserva la web', (role) => {
    expect(isFamilyAccount(links({ activeRoles: [role] }))).toBe(false);
  });

  // «NO afecta a staff ni a dirección: siguen usando la web igual», y el staff gana
  // sobre el vínculo familiar igual que en SU-2. La alternativa —la misma cuenta dentro
  // por un lado y fuera por otro— no es un estado que se pueda pintar.
  it('EL STAFF GANA: un entrenador que además es padre conserva la web', () => {
    expect(
      isFamilyAccount(links({ activeRoles: ['entrenador_ayudante'], isTutor: true })),
    ).toBe(false);
  });

  // La consola de plataforma solo existe en la web: cerrársela le deja sin herramienta.
  it('el superadmin conserva la web aunque sea tutor', () => {
    expect(isFamilyAccount(links({ isPlatformAdmin: true, isTutor: true }))).toBe(false);
  });

  // `activeRoles` son las memberships VIVAS: una baja saca al staff de la lista.
  it('un entrenador DADO DE BAJA que es tutor pasa a la app', () => {
    expect(isFamilyAccount(links({ activeRoles: [], isTutor: true }))).toBe(true);
  });

  // Hoy no puede ocurrir dentro del árbol autenticado (hace falta una membership, y los
  // 6 roles están cubiertos). Se fija igual, y hacia ABIERTO: este corte no protege
  // nada, así que equivocarse dejando la web no abre ninguna puerta.
  it('sin ningún vínculo NO es familia: se queda la web', () => {
    expect(isFamilyAccount(links())).toBe(false);
  });
});

/**
 * CONTRATO con SU-2, y el motivo por el que `isFamilyAccount` no es un alias.
 *
 * Hoy los dos predicados coinciden sobre TODAS las entradas posibles, y eso se
 * comprueba en vez de suponerse: 64 subconjuntos de los 6 roles de club × superadmin ×
 * tutor × seguidor = 512 combinaciones.
 *
 * El día que se separen —un delegado que paga, una categoría que sigue en la web— este
 * test se pone rojo. Eso es lo que queremos que pase: obliga a decidir CUÁL de las dos
 * preguntas ha cambiado, en vez de que una regla de facturación le quite el navegador a
 * alguien en silencio. Y avisa además de algo concreto: `evaluateFamilyWebCutFromClient`
 * lee «es familia» de `my_subscription_status()`, así que ese día esa RPC deja de ser
 * una fuente válida para esta pregunta y hace falta SQL propio.
 */
describe('contrato con requiresSubscription (SU-2)', () => {
  function subsets(roles: readonly Role[]): Role[][] {
    return roles.reduce<Role[][]>((acc, r) => [...acc, ...acc.map((s) => [...s, r])], [
      [],
    ]);
  }

  it('coinciden sobre las 512 combinaciones posibles', () => {
    const roleSets = subsets(ALL_CLUB_ROLES);
    expect(roleSets).toHaveLength(64);

    const discrepancias: string[] = [];
    let comprobadas = 0;

    for (const activeRoles of roleSets) {
      for (const isPlatformAdmin of [false, true]) {
        for (const isTutor of [false, true]) {
          for (const isSpectator of [false, true]) {
            const l = { isPlatformAdmin, activeRoles, isTutor, isSpectator };
            comprobadas += 1;
            if (isFamilyAccount(l) !== requiresSubscription(l)) {
              discrepancias.push(
                `roles=[${activeRoles.join(',')}] admin=${isPlatformAdmin} ` +
                  `tutor=${isTutor} seguidor=${isSpectator}`,
              );
            }
          }
        }
      }
    }

    expect(comprobadas).toBe(512);
    expect(discrepancias).toEqual([]);
  });
});

/**
 * La AUTORIDAD de «familia no es un rol» no es este fichero: es el comment de
 * `memberships.role` en la migración `20260822000000`. Si alguien añadiera un séptimo
 * rol al CHECK, las tres cláusulas de `isFamilyAccount` dejarían de cubrir el espacio y
 * el rol nuevo caería por defecto del lado de «conserva la web» — en silencio.
 */
describe('los 6 roles de club están cubiertos', () => {
  it('cada rol cae explícitamente de un lado o del otro', () => {
    expect(ALL_CLUB_ROLES).toHaveLength(6);
    const familia = ALL_CLUB_ROLES.filter((r) => isFamilyAccount(links({ activeRoles: [r] })));
    const web = ALL_CLUB_ROLES.filter((r) => !isFamilyAccount(links({ activeRoles: [r] })));
    expect(familia).toEqual(['jugador']);
    expect([...web].sort()).toEqual([...STAFF_ROLES].sort());
  });
});
