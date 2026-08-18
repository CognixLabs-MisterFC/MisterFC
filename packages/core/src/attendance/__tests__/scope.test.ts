import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAttendanceScopeFromClient } from '../scope';
import type { Database } from '../../supabase/types';

/**
 * Mock table-aware: `seasons`/`player_accounts` terminan en `.eq()`, `team_staff`
 * en `.is()`; todos awaitables. Espeja el mock de staff-scope.
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

describe('resolveAttendanceScopeFromClient (filtro por temporada activa)', () => {
  it('admin_club → all sin tocar la BD', async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient<Database>;
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'admin_club',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'all' });
    expect(from).not.toHaveBeenCalled();
  });

  it('sin userId → none', async () => {
    const client = {} as unknown as SupabaseClient<Database>;
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_principal',
      userId: null,
    });
    expect(scope).toEqual({ kind: 'none' });
  });

  it('entrenador → restricted a sus equipos (otro profile/club fuera)', async () => {
    const client = makeClient({
      seasons: [{ label: '2026-27', status: 'active' }],
      team_staff: [
        { team_id: 't-1', teams: { season: '2026-27' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-9', teams: { season: '2026-27' }, memberships: { profile_id: 'OTHER', club_id: 'club-1' } },
        { team_id: 't-8', teams: { season: '2026-27' }, memberships: { profile_id: 'u-1', club_id: 'OTHER-CLUB' } },
      ],
    });
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'entrenador_principal',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'restricted', teamIds: ['t-1'] });
  });

  it('ignora equipos de temporada NO activa (dato caduco tras rollover)', async () => {
    const client = makeClient({
      seasons: [{ label: '2026-27', status: 'active' }, { label: '2025-26', status: 'finalized' }],
      team_staff: [
        { team_id: 't-viejo', teams: { season: '2025-26' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
        { team_id: 't-nuevo', teams: { season: '2026-27' }, memberships: { profile_id: 'u-1', club_id: 'club-1' } },
      ],
    });
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'coordinador',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'restricted', teamIds: ['t-nuevo'] });
  });

  it('jugador → player con sus playerIds del club', async () => {
    const client = makeClient({
      player_accounts: [
        { player_id: 'p-1', players: { club_id: 'club-1' } },
        { player_id: 'p-2', players: { club_id: 'OTHER' } },
      ],
    });
    const scope = await resolveAttendanceScopeFromClient(client, {
      clubId: 'club-1',
      role: 'jugador',
      userId: 'u-1',
    });
    expect(scope).toEqual({ kind: 'player', playerIds: ['p-1'] });
  });
});
