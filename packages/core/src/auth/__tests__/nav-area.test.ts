import { describe, expect, it } from 'vitest';
import { navAreaForRole, type NavArea } from '../nav-area';
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
