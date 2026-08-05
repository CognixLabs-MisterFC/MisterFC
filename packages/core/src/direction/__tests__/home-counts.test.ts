import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  countPendingInvitationsFromClient,
  countPendingErasuresFromClient,
  getDireccionHomeCountsFromClient,
} from '../home-counts';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';

/** Mock por tabla con respuesta canónica reutilizable (orden-independiente bajo
 * Promise.all) y contador de llamadas por tabla. Una respuesta `{count,data}`
 * sirve tanto a queries de conteo (head) como de datos. */
function makeClient(responses: Record<string, unknown>, calls: Record<string, number> = {}) {
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ['select', 'eq', 'is', 'not', 'or', 'in', 'gt', 'gte', 'lte', 'order', 'limit', 'maybeSingle', 'single'])
      q[m] = chain;
    q.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
      calls[table] = (calls[table] ?? 0) + 1;
      return Promise.resolve(responses[table]).then(onF, onR);
    };
    return q;
  };
  return { from: (t: string) => build(t) } as unknown as SupabaseClient<Database>;
}

describe('conteos del Inicio de dirección', () => {
  it('countPendingInvitationsFromClient devuelve el count (null → 0)', async () => {
    expect(await countPendingInvitationsFromClient(makeClient({ invitations: { count: 3 } }), CLUB)).toBe(3);
    expect(await countPendingInvitationsFromClient(makeClient({ invitations: { count: null } }), CLUB)).toBe(0);
  });

  it('countPendingErasuresFromClient devuelve el count', async () => {
    expect(await countPendingErasuresFromClient(makeClient({ erasure_requests: { count: 2 } }), CLUB)).toBe(2);
  });

  it('getDireccionHomeCounts: escenario a cero sin pedir supresiones NO consulta erasure_requests', async () => {
    const calls: Record<string, number> = {};
    const sb = makeClient(
      {
        invitations: { count: 0 },
        events: { count: 0, data: [] },
        seasons: { data: null },
      },
      calls
    );
    const r = await getDireccionHomeCountsFromClient(sb, CLUB, { includeErasures: false });
    expect(r).toEqual({
      pendingInvitations: 0,
      pendingErasures: 0,
      pendingApprovals: 0,
      trainingsWithoutSession: 0,
      trainingsWithoutAttendance: 0,
      pendingCallups: 0,
      pendingReports: 0,
    });
    expect(calls.erasure_requests ?? 0).toBe(0);
  });

  it('getDireccionHomeCounts: con includeErasures consulta y refleja las supresiones', async () => {
    const calls: Record<string, number> = {};
    const sb = makeClient(
      {
        invitations: { count: 0 },
        erasure_requests: { count: 5 },
        events: { count: 0, data: [] },
        seasons: { data: null },
      },
      calls
    );
    const r = await getDireccionHomeCountsFromClient(sb, CLUB, { includeErasures: true });
    expect(r.pendingErasures).toBe(5);
    expect(calls.erasure_requests).toBe(1);
  });
});
