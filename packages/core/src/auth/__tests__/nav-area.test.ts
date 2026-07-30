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
