import { describe, expect, it } from 'vitest';
import { ADMIN_ROLES } from '../../auth/roles';
import type { Role } from '../../auth/current-user';
import { TEAM_STAFF_ROLES } from '../../schemas/staff';
import { staffAssignmentPermission } from '../assignment-policy';

/**
 * W-2 — la regla de quién agrega un rol de equipo, y con qué.
 *
 * Se prueba aquí y no en la web porque `apps/web` no tiene runner (lo mismo que
 * llevó `assignStaffToTeam` a core en W-1). Estos son los tres ejes que la pantalla
 * nativa habría tenido que adivinar: quién, qué funciones y de qué lista de equipos.
 */
describe('staffAssignmentPermission · quién agrega un rol', () => {
  it('admin_club ofrece TODAS las funciones sobre TODOS los equipos del club', () => {
    expect(staffAssignmentPermission('admin_club')).toEqual({
      canAssign: true,
      roles: TEAM_STAFF_ROLES,
      teamSource: 'all_club_teams',
    });
  });

  it('el director va con admin_club, no aparte', () => {
    expect(staffAssignmentPermission('director')).toEqual(
      staffAssignmentPermission('admin_club'),
    );
  });

  it('el coordinador SÍ agrega roles: el comentario de la web que decía que no estaba rancio', () => {
    expect(staffAssignmentPermission('coordinador').canAssign).toBe(true);
  });

  it('pero el coordinador NO puede nombrar coordinadores (C-2c)', () => {
    const { roles } = staffAssignmentPermission('coordinador');
    expect(roles).not.toContain('coordinador');
    // Y no se le quita nada más por el camino.
    expect(roles).toEqual(TEAM_STAFF_ROLES.filter((r) => r !== 'coordinador'));
  });

  it('y solo sobre SUS equipos, no sobre todo el club (C-2a)', () => {
    expect(staffAssignmentPermission('coordinador').teamSource).toBe('own_coordinated_teams');
  });

  it('el entrenador principal VE la lista pero no agrega: su scope no es permiso', () => {
    // `resolveStaffScope` le da 'restricted' (ve a su staff), pero no está en
    // ADMIN_ROLES. Confundir las dos cosas le daría una acción que la RLS le niega.
    expect(staffAssignmentPermission('entrenador_principal')).toEqual({
      canAssign: false,
      roles: [],
      teamSource: 'none',
    });
  });

  it('ayudante y jugador, nada', () => {
    for (const role of ['entrenador_ayudante', 'jugador'] as const) {
      expect(staffAssignmentPermission(role).canAssign).toBe(false);
    }
  });

  it('sin rol (sesión a medio cargar) tampoco: null y undefined no revientan', () => {
    expect(staffAssignmentPermission(null).canAssign).toBe(false);
    expect(staffAssignmentPermission(undefined).canAssign).toBe(false);
  });
});

describe('staffAssignmentPermission · invariantes', () => {
  /**
   * ESTE test es la alarma del diseño. `staffAssignmentPermission` pregunta a
   * ADMIN_ROLES y DESPUÉS clasifica rol por rol; un rol nuevo en ADMIN_ROLES cae en
   * el `default` y se queda sin la acción. Eso falla cerrado, que es lo correcto en
   * runtime, pero en silencio. Si este test se pone rojo no es un bug: es que hay un
   * rol de gestión nuevo y alguien tiene que decidir qué equipos le tocan.
   */
  it('todo rol de ADMIN_ROLES está clasificado a mano', () => {
    for (const role of ADMIN_ROLES) {
      const p = staffAssignmentPermission(role);
      expect(p.canAssign, `${role} está en ADMIN_ROLES pero no en el switch`).toBe(true);
      expect(p.teamSource, `${role} no tiene de dónde sacar equipos`).not.toBe('none');
      expect(p.roles.length, `${role} puede agregar pero sin ninguna función`).toBeGreaterThan(0);
    }
  });

  /**
   * El espejo del anterior, y el que hace que el filtro de ADMIN_ROLES sirva para
   * algo. El `switch` clasifica los tres roles de hoy; si mañana alguno SALE de
   * ADMIN_ROLES pero se queda en el `switch`, sin el filtro seguiría ofreciendo la
   * acción a quien ya no es gestor. Este es el lado que falla ABIERTO, así que se
   * mide contra la lista, no contra una lista escrita a mano.
   */
  it('ningún rol de fuera de ADMIN_ROLES agrega, aunque esté en el switch', () => {
    const todos: Role[] = [
      'admin_club',
      'director',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ];
    for (const role of todos.filter((r) => !ADMIN_ROLES.includes(r))) {
      expect(
        staffAssignmentPermission(role).canAssign,
        `${role} no está en ADMIN_ROLES y aun así agrega roles`,
      ).toBe(false);
    }
  });

  it('quien no agrega no lleva funciones ni lista de equipos', () => {
    const roles: Role[] = ['entrenador_principal', 'entrenador_ayudante', 'jugador'];
    for (const role of roles) {
      const p = staffAssignmentPermission(role);
      expect(p.roles).toEqual([]);
      expect(p.teamSource).toBe('none');
    }
  });

  it('nunca se ofrece una función que no sea de team_staff', () => {
    const todos: (Role | null)[] = [
      'admin_club',
      'director',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
      null,
    ];
    for (const role of todos) {
      for (const r of staffAssignmentPermission(role).roles) {
        expect(TEAM_STAFF_ROLES).toContain(r);
      }
    }
  });
});
