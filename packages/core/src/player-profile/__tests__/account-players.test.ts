import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  getAccountPlayersForProfile,
  getAccountPlayersFromClient,
} from '../account-players';

type Row = {
  player_id: string;
  relation: string;
  players: {
    id: string;
    club_id: string;
    first_name: string;
    last_name: string | null;
    erased_at: string | null;
  };
};

/** Mock mínimo del cliente supabase-js: auth.getUser + from().select().order().eq(). */
function mockClient(
  rows: Row[],
  user: { id: string } | null,
): SupabaseClient<Database> {
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: () => Promise.resolve({ data: rows }),
  };
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => builder,
  } as unknown as SupabaseClient<Database>;
}

const ROWS: Row[] = [
  { player_id: 'p1', relation: 'parent', players: { id: 'p1', club_id: 'C', first_name: 'Ana', last_name: 'Gil', erased_at: null } },
  { player_id: 'p2', relation: 'guardian', players: { id: 'p2', club_id: 'OTRO', first_name: 'Zoe', last_name: 'Paz', erased_at: null } },
  { player_id: 'p3', relation: 'self', players: { id: 'p3', club_id: 'C', first_name: 'Leo', last_name: 'Mas', erased_at: '2026-01-01' } },
  { player_id: 'p4', relation: 'parent', players: { id: 'p4', club_id: 'C', first_name: 'Max', last_name: null, erased_at: null } },
];

describe('getAccountPlayersForProfile', () => {
  it('filtra por club, excluye suprimidos y preserva el orden', async () => {
    const sb = mockClient(ROWS, { id: 'tutor1' });
    const players = await getAccountPlayersForProfile(sb, 'tutor1', 'C');
    expect(players).toEqual([
      { id: 'p1', name: 'Ana Gil', relation: 'parent' },
      { id: 'p4', name: 'Max', relation: 'parent' }, // last_name null → sin espacio final
    ]);
  });

  it('otro club → los hijos de ese club', async () => {
    const sb = mockClient(ROWS, { id: 'tutor1' });
    expect(await getAccountPlayersForProfile(sb, 'tutor1', 'OTRO')).toEqual([
      { id: 'p2', name: 'Zoe Paz', relation: 'guardian' },
    ]);
  });

  it('sin filas → []', async () => {
    const sb = mockClient([], { id: 'tutor1' });
    expect(await getAccountPlayersForProfile(sb, 'tutor1', 'C')).toEqual([]);
  });
});

describe('getAccountPlayersFromClient', () => {
  it('resuelve el user autenticado y devuelve sus hijos del club', async () => {
    const sb = mockClient(ROWS, { id: 'tutor1' });
    const players = await getAccountPlayersFromClient(sb, 'C');
    expect(players.map((p) => p.id)).toEqual(['p1', 'p4']);
  });

  it('sin sesión (getUser null) → []', async () => {
    const sb = mockClient(ROWS, null);
    expect(await getAccountPlayersFromClient(sb, 'C')).toEqual([]);
  });
});
