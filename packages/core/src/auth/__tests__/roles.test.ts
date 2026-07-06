import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLES,
  MANAGER_ROLES,
  STAFF_ROLES,
  COACH_ROLES,
  ALL_CLUB_ROLES,
} from '../roles';

/**
 * F1B-3 — red anti-deriva: fija qué rol pertenece a qué familia. En particular
 * que 'director' entra en admin/manager/staff (paridad con admin en UI) y NO en
 * coach (coach = identidad de equipo, no rol de club).
 */
describe('familias de rol de club', () => {
  it('director está en admin/manager/staff (= admin en datos/vistas)', () => {
    expect(ADMIN_ROLES).toContain('director');
    expect(MANAGER_ROLES).toContain('director');
    expect(STAFF_ROLES).toContain('director');
  });

  it('director NO está en COACH_ROLES (no es entrenador de equipo)', () => {
    expect(COACH_ROLES).not.toContain('director');
  });

  it('COACH_ROLES = solo entrenadores de equipo', () => {
    expect([...COACH_ROLES].sort()).toEqual([
      'entrenador_ayudante',
      'entrenador_principal',
    ]);
  });

  it('ADMIN_ROLES = admin + director + coordinador', () => {
    expect([...ADMIN_ROLES].sort()).toEqual([
      'admin_club',
      'coordinador',
      'director',
    ]);
  });

  it('MANAGER_ROLES = ADMIN_ROLES + entrenador_principal', () => {
    expect([...MANAGER_ROLES].sort()).toEqual([
      'admin_club',
      'coordinador',
      'director',
      'entrenador_principal',
    ]);
  });

  it('STAFF_ROLES = todo el cuerpo técnico de club (incl. ayudante), sin jugador', () => {
    expect([...STAFF_ROLES].sort()).toEqual([
      'admin_club',
      'coordinador',
      'director',
      'entrenador_ayudante',
      'entrenador_principal',
    ]);
    expect(STAFF_ROLES).not.toContain('jugador');
  });

  it('las familias de gestión son subconjuntos coherentes', () => {
    // admin ⊆ manager ⊆ staff
    for (const r of ADMIN_ROLES) expect(MANAGER_ROLES).toContain(r);
    for (const r of MANAGER_ROLES) expect(STAFF_ROLES).toContain(r);
  });

  it('ALL_CLUB_ROLES tiene los 6 roles', () => {
    expect([...ALL_CLUB_ROLES].sort()).toEqual([
      'admin_club',
      'coordinador',
      'director',
      'entrenador_ayudante',
      'entrenador_principal',
      'jugador',
    ]);
  });
});
