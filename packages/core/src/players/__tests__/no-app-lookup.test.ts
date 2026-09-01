import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  getPlayersWithoutAppFromClient,
  getTeamPlayersWithoutAppFromClient,
} from '../no-app-lookup';

/** Mock mínimo: la cadena resuelve a `data`/`error`. Registra tabla, select e ids. */
function client(result: { data?: unknown[]; error?: unknown }) {
  const calls: { select: string; ids: string[]; from: string[] } = {
    select: '',
    ids: [],
    from: [],
  };
  const sb = {
    from: (table: string) => {
      calls.from.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = (sel: string) => {
        calls.select = sel;
        return chain;
      };
      chain.in = (_col: string, ids: string[]) => {
        calls.ids = ids;
        return chain;
      };
      chain.eq = () => chain;
      chain.is = () => chain;
      (chain as { then: unknown }).then = (f: (v: unknown) => unknown) =>
        Promise.resolve({ data: result.data ?? [], error: result.error ?? null }).then(f);
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, calls };
}

describe('getPlayersWithoutAppFromClient (Slices B/C)', () => {
  it('sin ids NO consulta (las listas que no pintan marcador no pagan nada)', async () => {
    const { sb, calls } = client({ data: [] });
    expect(await getPlayersWithoutAppFromClient(sb, [])).toEqual([]);
    expect(calls.from).toEqual([]);
  });

  it('devuelve SOLO los que no tienen familia vinculada', async () => {
    const { sb, calls } = client({
      data: [
        { id: 'p1', player_accounts: [{ profile_id: 'u1' }] },
        { id: 'p2', player_accounts: [] },
        { id: 'p3', player_accounts: null },
      ],
    });
    expect(await getPlayersWithoutAppFromClient(sb, ['p1', 'p2', 'p3'])).toEqual(['p2', 'p3']);
    expect(calls.ids).toEqual(['p1', 'p2', 'p3']);
    expect(calls.from).toEqual(['players']);
    expect(calls.select).toContain('player_accounts');
    // Un solo marcador ⇒ ya NO se leen invitaciones en este loader.
    expect(calls.select).not.toContain('invitations');
  });

  it('un jugador que no vuelve (RLS/inexistente) NO se marca', async () => {
    const { sb } = client({ data: [{ id: 'p1', player_accounts: [] }] });
    expect(await getPlayersWithoutAppFromClient(sb, ['p1', 'p2'])).toEqual(['p1']);
  });

  it('un error se reporta al sumidero y no marca a nadie', async () => {
    const onError = vi.fn();
    const { sb } = client({ data: [], error: { message: 'boom' } });
    expect(await getPlayersWithoutAppFromClient(sb, ['p1'], onError)).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('getTeamPlayersWithoutAppFromClient', () => {
  it('sale del roster ACTIVO del equipo, en una query, sin invitaciones', async () => {
    const { sb, calls } = client({
      data: [
        { player_id: 'p1', players: { player_accounts: [{ profile_id: 'u1' }] } },
        { player_id: 'p2', players: { player_accounts: [] } },
      ],
    });
    expect(await getTeamPlayersWithoutAppFromClient(sb, 'T1')).toEqual(['p2']);
    expect(calls.from).toEqual(['team_members']);
    expect(calls.select).toContain('player_accounts');
    expect(calls.select).not.toContain('invitations');
  });
});
