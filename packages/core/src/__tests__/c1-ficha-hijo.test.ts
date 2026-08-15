import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { playerScopedCacheKey } from '../offline/read-cache';
import {
  getPlayerSpectatorsFromClient,
  removeSpectatorFromClient,
} from '../spectators/index';
import { getPlayerReportBundleFromClient } from '../development-report/report-bundle';

type TableResult = { data?: unknown[] };

/** Mock table-aware: cada tabla resuelve a su resultado; maybeSingle → 1ª fila. */
function tableClient(tables: Record<string, TableResult>): SupabaseClient<Database> {
  const res = (table: string): TableResult => tables[table] ?? { data: [] };
  function builder(table: string) {
    const r = res(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'lte', 'gte', 'lt', 'is', 'or', 'not']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (f: (v: TableResult) => unknown) => Promise.resolve(r).then(f);
    (chain as { maybeSingle: unknown }).maybeSingle = () =>
      Promise.resolve({ data: (r.data ?? [])[0] ?? null });
    return chain;
  }
  return { from: (tbl: string) => builder(tbl) } as unknown as SupabaseClient<Database>;
}

/** Mock mínimo: rpc devuelve lo prefijado; auth.getUser devuelve el user dado. */
function mockClient(cfg: {
  rpc?: Record<string, { data?: unknown; error?: { message: string } | null }>;
  user?: { id: string } | null;
}): SupabaseClient<Database> {
  return {
    rpc: async (name: string) => cfg.rpc?.[name] ?? { data: null, error: null },
    auth: { getUser: async () => ({ data: { user: cfg.user ?? null } }) },
  } as unknown as SupabaseClient<Database>;
}

describe('playerScopedCacheKey (norma CRÍTICA C1)', () => {
  it('mete clubId Y playerId; cambiar de hijo → key distinta', () => {
    expect(playerScopedCacheKey('ficha', 'C1', 'P1')).toBe('ficha.C1.P1');
    // Mismo club, hijo distinto → NUNCA la misma key (no servir ficha del otro hijo).
    expect(playerScopedCacheKey('ficha', 'C1', 'P1')).not.toBe(
      playerScopedCacheKey('ficha', 'C1', 'P2'),
    );
    // Mismo hijo, club distinto → key distinta.
    expect(playerScopedCacheKey('ficha', 'C1', 'P1')).not.toBe(
      playerScopedCacheKey('ficha', 'C2', 'P1'),
    );
    expect(playerScopedCacheKey('informe', 'C1', 'P1')).toBe('informe.C1.P1');
    expect(playerScopedCacheKey('seguidores', 'C1', 'P1')).toBe('seguidores.C1.P1');
  });
});

describe('seguidores (C1)', () => {
  it('getPlayerSpectatorsFromClient devuelve las filas del RPC', async () => {
    const sb = mockClient({
      rpc: {
        list_player_spectators: {
          data: [
            { spectator_profile_id: 's1', full_name: 'Abuela', email: 'a@x.com', created_at: 'x' },
          ],
        },
      },
    });
    const rows = await getPlayerSpectatorsFromClient(sb, 'P1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spectator_profile_id).toBe('s1');
  });

  it('removeSpectatorFromClient: sin sesión → forbidden; ok; error genérico con raw', async () => {
    expect(await removeSpectatorFromClient(mockClient({ user: null }), 'P1', 's1')).toEqual({
      error: 'forbidden',
    });
    const ok = mockClient({ user: { id: 'u1' }, rpc: { remove_spectator: { error: null } } });
    expect(await removeSpectatorFromClient(ok, 'P1', 's1')).toEqual({ ok: true });
    const forbidden = mockClient({
      user: { id: 'u1' },
      rpc: { remove_spectator: { error: { message: 'forbidden' } } },
    });
    expect(await removeSpectatorFromClient(forbidden, 'P1', 's1')).toEqual({ error: 'forbidden' });
    const generic = mockClient({
      user: { id: 'u1' },
      rpc: { remove_spectator: { error: { message: 'boom' } } },
    });
    const res = await removeSpectatorFromClient(generic, 'P1', 's1');
    expect('error' in res && res.error).toBe('generic');
  });
});

describe('mi informe (getPlayerReportBundleFromClient)', () => {
  it('sin temporadas → report null, seasons vacío', async () => {
    const sb = tableClient({ team_members: { data: [] } });
    const b = await getPlayerReportBundleFromClient(sb, 'C1', 'P1');
    expect(b.seasons).toEqual([]);
    expect(b.activeSeason).toBeNull();
    expect(b.report).toBeNull();
  });

  it('con temporada pero sin periodos publicados → activeSeason resuelto, report null', async () => {
    const sb = tableClient({
      team_members: { data: [{ left_at: null, teams: { season: '2025-26' } }] },
      seasons: { data: [{ id: 's1' }] },
      development_reports: { data: [] }, // ningún periodo publicado
    });
    const b = await getPlayerReportBundleFromClient(sb, 'C1', 'P1');
    expect(b.activeSeason).toBe('2025-26');
    expect(b.periods).toEqual([]);
    expect(b.report).toBeNull();
  });
});
