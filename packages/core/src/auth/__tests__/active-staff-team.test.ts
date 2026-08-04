import { describe, expect, it } from 'vitest';
import { resolveActivePlayer } from '../spectator';

/**
 * O2-10b-2 — Resolución del EQUIPO ACTIVO del coordinador. El provider nativo
 * (`active-staff-team.tsx`) reutiliza el helper puro genérico `resolveActivePlayer`
 * con la clave `teamId` de `StaffTeamCard`. Aquí se prueba ese uso concreto: 0 / 1 /
 * varios equipos, guardado válido/obsoleto. La lista la provee
 * `getStaffTeamsFromClient` (solo team_staff del coordinador → ya cubre el scope; su
 * exclusión de equipos no coordinados está testeada en team-view/staff-teams).
 */
type TeamCard = { teamId: string; name: string };
const idOf = (t: TeamCard) => t.teamId;

const t1: TeamCard = { teamId: 'team-1', name: 'Alevín A' };
const t2: TeamCard = { teamId: 'team-2', name: 'Benjamín B' };

describe('equipo activo del coordinador (resolveActivePlayer con teamId)', () => {
  it('sin equipos → null (no coordina ninguno)', () => {
    const r = resolveActivePlayer([], 'team-9', idOf);
    expect(r).toEqual({ active: null, staleCookie: false });
  });

  it('un solo equipo → ese, sin guardado', () => {
    const r = resolveActivePlayer([t1], null, idOf);
    expect(r.active).toBe(t1);
    expect(r.staleCookie).toBe(false);
  });

  it('varios equipos, guardado válido → el guardado', () => {
    const r = resolveActivePlayer([t1, t2], 'team-2', idOf);
    expect(r.active).toBe(t2);
    expect(r.staleCookie).toBe(false);
  });

  it('varios equipos, sin guardado → el primero (default)', () => {
    const r = resolveActivePlayer([t1, t2], null, idOf);
    expect(r.active).toBe(t1);
    expect(r.staleCookie).toBe(false);
  });

  it('guardado apunta a un equipo que ya NO coordina → default + staleCookie', () => {
    const r = resolveActivePlayer([t1, t2], 'team-borrado', idOf);
    expect(r.active).toBe(t1);
    expect(r.staleCookie).toBe(true);
  });
});
