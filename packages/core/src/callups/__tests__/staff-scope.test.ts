import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveConvocatoriasScopeFromClient } from '../staff-scope';
import type { Database } from '../../supabase/types';

/**
 * Mock table-aware: cada tabla resuelve su `data`. `team_staff` termina en `.is()`,
 * `player_accounts` en `.eq()`; ambos deben ser awaitables.
 */
function makeClient(data: {
  team_staff?: unknown[];
  player_accounts?: unknown[];
  seasons?: unknown[];
}): SupabaseClient<Database> {
  const from = (table: keyof typeof data) => {
    const rows = data[table] ?? [];
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.is = async () => ({ data: rows });
    builder.eq = async () => ({ data: rows });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe('O2-7b-1 · resolveConvocatoriasScopeFromClient (espejo del gate RLS)', () => {
  it('admin_club → all sin tocar la BD', async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient<Database>;
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'admin_club',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'all' });
    expect(from).not.toHaveBeenCalled();
  });

  it('director → all (club-wide como admin_club)', async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient<Database>;
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'director',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'all' });
    expect(from).not.toHaveBeenCalled();
  });

  it('sin userId → none', async () => {
    const client = {} as unknown as SupabaseClient<Database>;
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_principal',
      userId: null,
    });
    expect(scope).toEqual({ kind: 'none' });
  });

  it('principal → gestiona TODOS sus equipos del club (O2: de serie)', async () => {
    const client = makeClient({
      seasons: [{ label: '2025-26', status: 'active' }],
      team_staff: [
        { team_id: 't-1', staff_role: 'entrenador_principal', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-2', staff_role: 'entrenador_ayudante', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-9', staff_role: 'entrenador_principal', teams: { season: '2025-26' }, memberships: { profile_id: 'OTHER', club_id: 'club-1' } },
        { team_id: 't-8', staff_role: 'entrenador_principal', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'OTHER-CLUB' } },
      ],
    });
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_principal',
      userId: 'u-1',
    });
    // Desde O2 gestionar convocatorias es de serie: managedTeamIds = teamIds.
    expect(scope).toEqual({
      kind: 'restricted',
      teamIds: ['t-1', 't-2'],
      managedTeamIds: ['t-1', 't-2'],
    });
  });

  it('ayudante → gestiona TODOS sus equipos de serie (sin capability)', async () => {
    const client = makeClient({
      seasons: [{ label: '2025-26', status: 'active' }],
      team_staff: [
        { team_id: 't-1', staff_role: 'entrenador_ayudante', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-2', staff_role: 'entrenador_ayudante', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      ],
    });
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_ayudante',
      userId: 'u-1',
    });
    expect(scope).toEqual({
      kind: 'restricted',
      teamIds: ['t-1', 't-2'],
      managedTeamIds: ['t-1', 't-2'],
    });
  });

  it('coordinador → gestiona TODOS sus equipos (managedTeamIds = teamIds)', async () => {
    const client = makeClient({
      seasons: [{ label: '2025-26', status: 'active' }],
      team_staff: [
        { team_id: 't-1', staff_role: 'coordinador', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-2', staff_role: 'coordinador', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      ],
    });
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'coordinador',
      userId: 'u-1',
    });
    expect(scope).toEqual({
      kind: 'restricted',
      teamIds: ['t-1', 't-2'],
      managedTeamIds: ['t-1', 't-2'],
    });
  });

  it('ignora equipos de temporada NO activa (dato caduco tras rollover)', async () => {
    const client = makeClient({
      seasons: [{ label: '2026-27', status: 'active' }, { label: '2025-26', status: 'finalized' }],
      team_staff: [
        // Vivo pero en el equipo de la temporada PASADA → debe ignorarse.
        { team_id: 't-viejo', staff_role: 'entrenador_principal', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        // Vivo en el equipo de la temporada activa → cuenta.
        { team_id: 't-nuevo', staff_role: 'entrenador_principal', teams: { season: '2026-27' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      ],
    });
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_principal',
      userId: 'u-1',
    });
    expect(scope).toEqual({
      kind: 'restricted',
      teamIds: ['t-nuevo'],
      managedTeamIds: ['t-nuevo'],
    });
  });

  it('jugador → player con sus playerIds del club', async () => {
    const client = makeClient({
      player_accounts: [
        { player_id: 'p-1', players: { club_id: 'club-1' } },
        { player_id: 'p-2', players: { club_id: 'OTHER' } },
      ],
    });
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'jugador',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'player', playerIds: ['p-1'] });
  });

  // S2 director-entrenador (modo Míster de la app).
  it('director + asStaffMember → restricted a SUS equipos (idéntico a un entrenador)', async () => {
    const teamStaff = [
      { team_id: 't-1', staff_role: 'entrenador_principal', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      { team_id: 't-2', staff_role: 'entrenador_ayudante', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      { team_id: 't-9', staff_role: 'entrenador_principal', teams: { season: '2025-26' }, memberships: { profile_id: 'OTHER', club_id: 'club-1' } },
    ];
    const dirScope = await resolveConvocatoriasScopeFromClient(
      makeClient({ seasons: [{ label: '2025-26', status: 'active' }], team_staff: teamStaff }),
      { clubId: 'club-1', role: 'director', userId: 'u-1', asStaffMember: true },
    );
    const coachScope = await resolveConvocatoriasScopeFromClient(
      makeClient({ seasons: [{ label: '2025-26', status: 'active' }], team_staff: teamStaff }),
      { clubId: 'club-1', role: 'entrenador_principal', userId: 'u-1' },
    );
    // MISMO resultado que un entrenador con las mismas asignaciones.
    expect(dirScope).toEqual({ kind: 'restricted', teamIds: ['t-1', 't-2'], managedTeamIds: ['t-1', 't-2'] });
    expect(dirScope).toEqual(coachScope);
  });

  it('admin_club + asStaffMember → restricted a SUS equipos', async () => {
    const scope = await resolveConvocatoriasScopeFromClient(
      makeClient({
        seasons: [{ label: '2025-26', status: 'active' }],
        team_staff: [
          { team_id: 't-1', staff_role: 'coordinador', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        ],
      }),
      { clubId: 'club-1', role: 'admin_club', userId: 'u-1', asStaffMember: true },
    );
    expect(scope).toEqual({ kind: 'restricted', teamIds: ['t-1'], managedTeamIds: ['t-1'] });
  });

  it('director SIN asStaffMember (web) → sigue all, sin tocar la BD', async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient<Database>;
    // Explícito false y omitido: ambos = comportamiento web (club entero).
    expect(
      await resolveConvocatoriasScopeFromClient(client, { clubId: 'club-1', role: 'director', userId: 'u-1', asStaffMember: false }),
    ).toEqual({ kind: 'all' });
    expect(from).not.toHaveBeenCalled();
  });

  it('coordinador + asStaffMember → no-op (su restricted de siempre, no la rama director)', async () => {
    const scope = await resolveConvocatoriasScopeFromClient(
      makeClient({
        seasons: [{ label: '2025-26', status: 'active' }],
        team_staff: [
          { team_id: 't-1', staff_role: 'coordinador', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        ],
      }),
      { clubId: 'club-1', role: 'coordinador', userId: 'u-1', asStaffMember: true },
    );
    expect(scope).toEqual({ kind: 'restricted', teamIds: ['t-1'], managedTeamIds: ['t-1'] });
  });
});
