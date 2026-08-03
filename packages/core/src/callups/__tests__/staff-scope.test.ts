import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveConvocatoriasScopeFromClient } from '../staff-scope';
import type { Database } from '../../supabase/types';

/**
 * Mock table-aware: cada tabla resuelve su `data`. `team_staff` termina en `.is()`,
 * `capabilities`/`player_accounts` en `.eq()`; ambos deben ser awaitables.
 */
function makeClient(data: {
  team_staff?: unknown[];
  capabilities?: unknown[];
  player_accounts?: unknown[];
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

  it('principal SIN capability → gestiona solo los equipos donde es principal', async () => {
    const client = makeClient({
      team_staff: [
        { team_id: 't-1', staff_role: 'entrenador_principal', memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-2', staff_role: 'entrenador_ayudante', memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-9', staff_role: 'entrenador_principal', memberships: { profile_id: 'OTHER', club_id: 'club-1' } },
        { team_id: 't-8', staff_role: 'entrenador_principal', memberships: { profile_id: 'u-1', club_id: 'OTHER-CLUB' } },
      ],
      capabilities: [],
    });
    const scope = await resolveConvocatoriasScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_principal',
      userId: 'u-1',
    });
    // teamIds = todos sus equipos del club; managedTeamIds = solo donde es principal.
    expect(scope).toEqual({
      kind: 'restricted',
      teamIds: ['t-1', 't-2'],
      managedTeamIds: ['t-1'],
    });
  });

  it('ayudante CON capability can_manage_callups → gestiona todos sus equipos', async () => {
    const client = makeClient({
      team_staff: [
        { team_id: 't-1', staff_role: 'entrenador_ayudante', memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-2', staff_role: 'entrenador_ayudante', memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      ],
      capabilities: [
        { granted: true, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
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
      team_staff: [
        { team_id: 't-1', staff_role: 'coordinador', memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-2', staff_role: 'coordinador', memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      ],
      capabilities: [],
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
});
