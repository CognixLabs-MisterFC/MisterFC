import { describe, expect, it } from 'vitest';
import {
  navAreaForRole,
  isAllowedInArea,
  type NavArea,
  type NavAudienceArea,
} from '../nav-area';
import { ALL_CLUB_ROLES } from '../roles';
import type { Role } from '../current-user';

describe('navAreaForRole', () => {
  const cases: Array<[Role, NavArea]> = [
    ['jugador', 'family'],
    ['entrenador_principal', 'staff'],
    ['entrenador_ayudante', 'staff'],
    // Divergencia deliberada con ADMIN_ROLES: en la CARCASA el coordinador es staff.
    ['coordinador', 'staff'],
    ['admin_club', 'direction'],
    ['director', 'direction'],
  ];

  it.each(cases)('proyecta %s → %s', (role, area) => {
    expect(navAreaForRole(role)).toBe(area);
  });

  it('cubre exhaustivamente los 6 roles de club', () => {
    for (const role of ALL_CLUB_ROLES) {
      expect(['family', 'staff', 'direction']).toContain(navAreaForRole(role));
    }
    expect(ALL_CLUB_ROLES).toHaveLength(6);
  });
});

describe('isAllowedInArea', () => {
  const AREAS: NavAudienceArea[] = ['family', 'staff', 'direction', 'spectator'];

  it('un miembro solo entra en el área que le proyecta su rol', () => {
    for (const role of ALL_CLUB_ROLES) {
      const own = navAreaForRole(role);
      for (const area of AREAS) {
        expect(isAllowedInArea(area, { kind: 'member', role })).toBe(
          area === own,
        );
      }
    }
  });

  it('el seguidor solo entra en spectator', () => {
    for (const area of AREAS) {
      expect(isAllowedInArea(area, { kind: 'spectator', role: null })).toBe(
        area === 'spectator',
      );
    }
  });

  it('un miembro NUNCA entra en spectator', () => {
    expect(
      isAllowedInArea('spectator', { kind: 'member', role: 'jugador' }),
    ).toBe(false);
  });

  it('sin acceso (none) o sin rol no entra en ningún área', () => {
    for (const area of AREAS) {
      expect(isAllowedInArea(area, { kind: 'none', role: null })).toBe(false);
      expect(isAllowedInArea(area, { kind: 'member', role: null })).toBe(false);
    }
  });
});

describe('isAllowedInArea · excepción S2 director-entrenador', () => {
  const DIRECTION_HOME: Role[] = ['admin_club', 'director'];

  it('director/admin_club CON equipos entra también en staff (además de direction)', () => {
    for (const role of DIRECTION_HOME) {
      const aud = { kind: 'member' as const, role, hasStaffTeams: true };
      expect(isAllowedInArea('staff', aud)).toBe(true); // modo entrenador
      expect(isAllowedInArea('direction', aud)).toBe(true); // su hogar, intacto
      expect(isAllowedInArea('family', aud)).toBe(false);
      expect(isAllowedInArea('spectator', aud)).toBe(false);
    }
  });

  it('director/admin_club SIN equipos NO entra en staff (solo direction)', () => {
    for (const role of DIRECTION_HOME) {
      // Explícito false y también el default (undefined) deben denegar staff.
      expect(
        isAllowedInArea('staff', { kind: 'member', role, hasStaffTeams: false }),
      ).toBe(false);
      expect(isAllowedInArea('staff', { kind: 'member', role })).toBe(false);
      expect(
        isAllowedInArea('direction', { kind: 'member', role, hasStaffTeams: false }),
      ).toBe(true);
    }
  });

  it('la excepción es SOLO direction→staff: un coordinador/entrenador con equipos NO entra en direction', () => {
    for (const role of ['coordinador', 'entrenador_principal', 'entrenador_ayudante'] as Role[]) {
      const aud = { kind: 'member' as const, role, hasStaffTeams: true };
      expect(isAllowedInArea('staff', aud)).toBe(true); // su hogar
      expect(isAllowedInArea('direction', aud)).toBe(false); // el flag NO abre direction
    }
  });

  it('hasStaffTeams es irrelevante fuera de un rol de dirección (jugador sigue solo en family)', () => {
    const aud = { kind: 'member' as const, role: 'jugador' as Role, hasStaffTeams: true };
    expect(isAllowedInArea('family', aud)).toBe(true);
    expect(isAllowedInArea('staff', aud)).toBe(false);
  });
});
