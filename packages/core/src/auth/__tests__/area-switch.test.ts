import { describe, expect, it } from 'vitest';
import {
  AREA_SWITCH_ORDER,
  areaSwitchRing,
  isAllowedInArea,
  navAreaForRole,
  nextAreaInSwitch,
  type NavArea,
  type NavAudience,
} from '../nav-area';
import { ALL_CLUB_ROLES } from '../roles';

/**
 * CONMUTADOR DE ÁREA — el único botón de la barra que cambia de carcasa.
 *
 * Hasta ahora alternaba entre dos: Club ↔ Míster. La entrada al modo tutor vivía en
 * el menú lateral, y era un sitio distinto para el mismo gesto ("quién soy ahora").
 * Ahora familia es la TERCERA parada del mismo botón.
 *
 * Lo que se protege aquí no es el rótulo, es que el anillo y el guard digan LO MISMO:
 * un botón que ofrezca un área que el guard rechaza rebota al gatekeeper sin error ni
 * pista, y un área que el guard permite pero el anillo no ofrece queda inalcanzable
 * desde la barra sin que nada se ponga rojo.
 */

const miembro = (over: Partial<NavAudience>): NavAudience => ({
  kind: 'member',
  role: 'director',
  ...over,
});

/** Todas las combinaciones de rol × equipos como staff × hijos vinculados. */
const TODAS_LAS_AUDIENCIAS: NavAudience[] = [
  ...ALL_CLUB_ROLES.flatMap((role) =>
    [false, true].flatMap((hasStaffTeams) =>
      [false, true].map((hasLinkedPlayers) => ({
        kind: 'member' as const,
        role,
        hasStaffTeams,
        hasLinkedPlayers,
      })),
    ),
  ),
  { kind: 'spectator', role: null },
  { kind: 'none', role: null },
];

describe('lo de siempre sigue igual: Club ↔ Míster', () => {
  const directorEntrenador = miembro({
    role: 'director',
    hasStaffTeams: true,
    hasLinkedPlayers: false,
  });

  it('un director con equipos rota entre su hogar y el modo entrenador', () => {
    expect(areaSwitchRing(directorEntrenador)).toEqual(['direction', 'staff']);
    expect(nextAreaInSwitch('direction', directorEntrenador)).toBe('staff');
    expect(nextAreaInSwitch('staff', directorEntrenador)).toBe('direction');
  });

  it('un director SIN equipos ni hijos no tiene a dónde ir', () => {
    const solo = miembro({ hasStaffTeams: false, hasLinkedPlayers: false });
    expect(areaSwitchRing(solo)).toEqual(['direction']);
    expect(nextAreaInSwitch('direction', solo)).toBeNull();
  });

  it('un entrenador sin hijos tampoco', () => {
    const coach = miembro({ role: 'entrenador_principal', hasLinkedPlayers: false });
    expect(areaSwitchRing(coach)).toEqual(['staff']);
    expect(nextAreaInSwitch('staff', coach)).toBeNull();
  });

  it('una familia de nacimiento tampoco', () => {
    const familia = miembro({ role: 'jugador' });
    expect(areaSwitchRing(familia)).toEqual(['family']);
    expect(nextAreaInSwitch('family', familia)).toBeNull();
  });

  it('el seguidor no rota: no tiene otra carcasa', () => {
    const seguidor: NavAudience = { kind: 'spectator', role: null };
    expect(areaSwitchRing(seguidor)).toEqual([]);
    expect(nextAreaInSwitch('spectator', seguidor)).toBeNull();
  });
});

describe('familia entra como tercera parada del mismo botón', () => {
  it('director con equipos Y con hijos: tres paradas, y vuelve al principio', () => {
    const a = miembro({ hasStaffTeams: true, hasLinkedPlayers: true });
    expect(areaSwitchRing(a)).toEqual(['direction', 'staff', 'family']);
    expect(nextAreaInSwitch('direction', a)).toBe('staff');
    expect(nextAreaInSwitch('staff', a)).toBe('family');
    // La vuelta: la tercera pulsación devuelve a casa, no deja al tutor encallado.
    expect(nextAreaInSwitch('family', a)).toBe('direction');
  });

  it('director SIN equipos y con hijos: dos paradas, dirección ↔ familia', () => {
    const a = miembro({ hasStaffTeams: false, hasLinkedPlayers: true });
    expect(areaSwitchRing(a)).toEqual(['direction', 'family']);
    // Esta es la IDA que hasta ahora solo existía en el menú lateral.
    expect(nextAreaInSwitch('direction', a)).toBe('family');
    expect(nextAreaInSwitch('family', a)).toBe('direction');
  });

  it('entrenador con hijos: staff ↔ familia', () => {
    const a = miembro({ role: 'entrenador_ayudante', hasLinkedPlayers: true });
    expect(areaSwitchRing(a)).toEqual(['staff', 'family']);
    expect(nextAreaInSwitch('staff', a)).toBe('family');
    expect(nextAreaInSwitch('family', a)).toBe('staff');
  });

  it('el coordinador rota como el resto del cuerpo técnico', () => {
    // Su ÁREA es staff aunque `ADMIN_ROLES` lo agrupe con dirección.
    const a = miembro({ role: 'coordinador', hasLinkedPlayers: true });
    expect(areaSwitchRing(a)).toEqual(['staff', 'family']);
  });
});

describe('el anillo y el guard nunca se contradicen', () => {
  it('toda parada ofrecida la permite `isAllowedInArea`', () => {
    for (const audiencia of TODAS_LAS_AUDIENCIAS) {
      for (const area of areaSwitchRing(audiencia)) {
        expect(
          isAllowedInArea(area, audiencia),
          `el anillo ofrece ${area} y el guard lo rechaza`,
        ).toBe(true);
      }
    }
  });

  it('toda área permitida está en el anillo (ninguna queda inalcanzable)', () => {
    // Las tres van a mano y NO desde `AREA_SWITCH_ORDER`: si se leyeran de la propia
    // constante bajo prueba, borrar familia de ella dejaría este test en verde
    // justamente en el caso que debe cazar. Comprobado: con familia fuera del orden,
    // así escrito se pone rojo; leyendo la constante, no.
    const TODAS: NavArea[] = ['direction', 'staff', 'family'];
    for (const audiencia of TODAS_LAS_AUDIENCIAS) {
      const anillo = new Set(areaSwitchRing(audiencia));
      for (const area of TODAS) {
        if (isAllowedInArea(area, audiencia)) {
          expect(anillo.has(area), `${area} permitida pero fuera del anillo`).toBe(true);
        }
      }
    }
  });

  it('el hogar de cada rol siempre está en su anillo', () => {
    for (const role of ALL_CLUB_ROLES) {
      const a: NavAudience = { kind: 'member', role };
      expect(areaSwitchRing(a)).toContain(navAreaForRole(role));
    }
  });
});

describe('propiedades de la rotación', () => {
  it('pulsando tantas veces como paradas se vuelve al punto de partida', () => {
    for (const audiencia of TODAS_LAS_AUDIENCIAS) {
      const anillo = areaSwitchRing(audiencia);
      if (anillo.length < 2) continue;
      const salida = anillo[0] as NavArea;
      let actual: NavArea = salida;
      const visitadas: NavArea[] = [];
      for (let i = 0; i < anillo.length; i += 1) {
        const siguiente = nextAreaInSwitch(actual, audiencia);
        expect(siguiente).not.toBeNull();
        actual = siguiente as NavArea;
        visitadas.push(actual);
      }
      // Ni se salta ninguna ni se queda dando vueltas entre dos.
      expect(new Set(visitadas).size).toBe(anillo.length);
      expect(actual).toBe(salida);
    }
  });

  it('el botón nunca lleva al área en la que ya estás', () => {
    for (const audiencia of TODAS_LAS_AUDIENCIAS) {
      for (const area of AREA_SWITCH_ORDER) {
        expect(nextAreaInSwitch(area, audiencia)).not.toBe(area);
      }
    }
  });

  it('desde un área ajena no hay conmutador (el guard va antes que la barra)', () => {
    const coach = miembro({ role: 'entrenador_principal', hasLinkedPlayers: true });
    expect(nextAreaInSwitch('direction', coach)).toBeNull();
  });

  it("el anillo nunca ofrece 'spectator'", () => {
    expect(AREA_SWITCH_ORDER).not.toContain('spectator');
    for (const audiencia of TODAS_LAS_AUDIENCIAS) {
      expect(areaSwitchRing(audiencia)).not.toContain('spectator');
    }
  });
});
