import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  upsertLineupPositionFromClient,
  setLineupFormationFromClient,
} from '../writes';
import type { Database } from '../../supabase/types';

const LINEUP = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLAYER = 'bbbbbbbb-0000-4000-8000-000000000002';
const EVENT = 'ev-1';

type Recorded = { table: string; payload: unknown; filters: Record<string, unknown> };

type ClientOpts = {
  eventId?: string | null; // lineups → event_id (null → not_found)
  format?: string | null; // events.teams.format (cap por modalidad)
  tournamentId?: string | null; // events.tournament_id
  fieldPlayerIds?: string[]; // titulares actuales en campo (cap)
  fieldRowsForFormation?: Array<{
    player_id: string;
    players: { position_main: string };
  }>;
  existingPosition?: { id: string } | null; // lineup_positions existente del jugador
  published?: boolean; // match_callup_meta.published_at
  existingDecision?: { decision: string } | null; // callup_decisions del jugador
  userId?: string | null;
  failOn?: { table: string; op: 'insert' | 'update'; message?: string; code?: string };
};

/**
 * Mock table-aware con ESCRITURAS. Distingue dos lecturas a `lineup_positions`:
 * `.maybeSingle()` = fila existente del jugador; thenable(lista) = titulares en
 * campo (cap / remap). `insert`/`update` se resuelven a `{error}` (inyectable por
 * `failOn`) y se registran para aserciones.
 */
function makeClient(opts: ClientOpts) {
  const inserts: Recorded[] = [];
  const updates: Recorded[] = [];

  const singleFor = (table: string): unknown => {
    switch (table) {
      case 'lineups':
        return opts.eventId === undefined
          ? { event_id: EVENT }
          : opts.eventId === null
            ? null
            : { event_id: opts.eventId };
      case 'events':
        return {
          teams: { format: opts.format ?? 'F7' },
          tournament_id: opts.tournamentId ?? null,
        };
      case 'match_callup_meta':
        return { published_at: opts.published ? '2026-01-01T00:00:00Z' : null };
      case 'lineup_positions':
        return opts.existingPosition ?? null;
      case 'callup_decisions':
        return opts.existingDecision ?? null;
      default:
        return null;
    }
  };

  const listFor = (table: string): unknown[] => {
    switch (table) {
      case 'lineup_positions':
        if (opts.fieldRowsForFormation) return opts.fieldRowsForFormation;
        return (opts.fieldPlayerIds ?? []).map((player_id) => ({ player_id }));
      default:
        return [];
    }
  };

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const maybeErr = (op: 'insert' | 'update') =>
      opts.failOn && opts.failOn.table === table && opts.failOn.op === op
        ? { error: { message: opts.failOn.message, code: opts.failOn.code } }
        : { error: null };

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    };
    builder.lte = () => builder;
    builder.order = () => builder;
    builder.maybeSingle = async () => ({ data: singleFor(table) });
    builder.then = (resolve: (v: { data: unknown[] }) => unknown) =>
      resolve({ data: listFor(table) });

    builder.insert = (payload: unknown) => {
      inserts.push({ table, payload, filters: { ...filters } });
      return Promise.resolve(maybeErr('insert'));
    };
    builder.update = (payload: unknown) => {
      const upd: Record<string, unknown> = {};
      upd.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return upd;
      };
      upd.then = (resolve: (v: unknown) => unknown) => {
        updates.push({ table, payload, filters: { ...filters } });
        return resolve(maybeErr('update'));
      };
      return upd;
    };
    return builder;
  };

  const client = {
    from,
    auth: {
      getUser: async () => ({
        data: {
          user: opts.userId === null ? null : { id: opts.userId ?? 'u-1' },
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;

  return { client, inserts, updates };
}

const baseUpsert = {
  lineup_id: LINEUP,
  player_id: PLAYER,
  location: 'field' as const,
  position_code: 'GK',
  x_pct: 50,
  y_pct: 92,
};

describe('O2-8b · upsertLineupPositionFromClient', () => {
  it('input inválido → error de validación (no toca BD)', async () => {
    const { client, inserts, updates } = makeClient({});
    const r = await upsertLineupPositionFromClient(client, { lineup_id: 'x' });
    expect(r.ok).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('lineup sin evento → not_found', async () => {
    const { client } = makeClient({ eventId: null });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('colocar en campo por debajo del tope → inserta la posición', async () => {
    const { client, inserts } = makeClient({
      format: 'F7',
      fieldPlayerIds: ['x1', 'x2'], // + este = 3 ≤ 7
      existingPosition: null,
    });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r.ok).toBe(true);
    const posInsert = inserts.find((i) => i.table === 'lineup_positions');
    expect(posInsert).toBeTruthy();
    expect(posInsert!.payload).toMatchObject({
      lineup_id: LINEUP,
      player_id: PLAYER,
      location: 'field',
      position_code: 'GK',
    });
  });

  it('colocar en campo lleno (F7 con 7 titulares) → too_many_starters, sin escribir', async () => {
    const { client, inserts, updates } = makeClient({
      format: 'F7',
      fieldPlayerIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], // + este = 8 > 7
    });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r).toEqual({ ok: false, error: 'too_many_starters' });
    expect(inserts.filter((i) => i.table === 'lineup_positions')).toHaveLength(0);
    expect(updates.filter((u) => u.table === 'lineup_positions')).toHaveLength(0);
  });

  it('un swap NO cuenta doble: el propio jugador ya en campo no dispara el tope', async () => {
    const { client } = makeClient({
      format: 'F7',
      fieldPlayerIds: ['a', 'b', 'c', 'd', 'e', 'f', PLAYER], // 7, uno es él
      existingPosition: { id: 'pos-1' },
    });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r.ok).toBe(true); // otros=6, +1=7 ≤ 7
  });

  it('mover a banquillo → update sin cap, coords null', async () => {
    const { client, updates } = makeClient({
      existingPosition: { id: 'pos-1' },
    });
    const r = await upsertLineupPositionFromClient(client, {
      lineup_id: LINEUP,
      player_id: PLAYER,
      location: 'bench',
    });
    expect(r.ok).toBe(true);
    const upd = updates.find((u) => u.table === 'lineup_positions');
    expect(upd!.payload).toMatchObject({
      location: 'bench',
      position_code: null,
      x_pct: null,
      y_pct: null,
    });
  });

  it('rechazo RLS (42501) en la escritura → forbidden', async () => {
    const { client } = makeClient({
      format: 'F7',
      fieldPlayerIds: [],
      existingPosition: null,
      failOn: { table: 'lineup_positions', op: 'insert', code: '42501' },
    });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('BUG 2: colocar sin decisión previa (borrador, no torneo) → inserta called_up', async () => {
    const { client, inserts } = makeClient({
      format: 'F7',
      fieldPlayerIds: [],
      existingPosition: null,
      published: false,
      existingDecision: null,
      tournamentId: null,
    });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r.ok).toBe(true);
    const dec = inserts.find((i) => i.table === 'callup_decisions');
    expect(dec).toBeTruthy();
    expect(dec!.payload).toMatchObject({
      event_id: EVENT,
      player_id: PLAYER,
      decision: 'called_up',
    });
  });

  it('BUG 2: convocatoria PUBLICADA → no auto-sincroniza (regla 6.6)', async () => {
    const { client, inserts } = makeClient({
      format: 'F7',
      fieldPlayerIds: [],
      existingPosition: null,
      published: true,
      existingDecision: null,
    });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r.ok).toBe(true);
    expect(inserts.find((i) => i.table === 'callup_decisions')).toBeUndefined();
  });

  it('BUG 2: partido de torneo → NO escribe convocatoria', async () => {
    const { client, inserts } = makeClient({
      format: 'F7',
      fieldPlayerIds: [],
      existingPosition: null,
      published: false,
      existingDecision: null,
      tournamentId: 'tour-1',
    });
    const r = await upsertLineupPositionFromClient(client, baseUpsert);
    expect(r.ok).toBe(true);
    expect(inserts.find((i) => i.table === 'callup_decisions')).toBeUndefined();
  });
});

describe('O2-8b · setLineupFormationFromClient', () => {
  it('lineup sin evento → not_found', async () => {
    const { client } = makeClient({ eventId: null });
    const r = await setLineupFormationFromClient(client, {
      lineup_id: LINEUP,
      formation_code: '4-3-3',
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('cambia formación: actualiza cabecera y reubica titulares por rol', async () => {
    const { client, updates } = makeClient({
      fieldRowsForFormation: [
        { player_id: 'gk', players: { position_main: 'goalkeeper' } },
        { player_id: 'df', players: { position_main: 'defender' } },
      ],
    });
    const r = await setLineupFormationFromClient(client, {
      lineup_id: LINEUP,
      formation_code: '4-3-3',
    });
    expect(r.ok).toBe(true);
    const header = updates.find(
      (u) => u.table === 'lineups' && (u.payload as { formation_code?: string }).formation_code,
    );
    expect(header!.payload).toMatchObject({ formation_code: '4-3-3' });
    // Cada titular reubicado con un update a lineup_positions.
    const posUpdates = updates.filter((u) => u.table === 'lineup_positions');
    expect(posUpdates.length).toBeGreaterThanOrEqual(2);
  });

  it('rechazo RLS (42501) al actualizar la cabecera → forbidden', async () => {
    const { client } = makeClient({
      fieldRowsForFormation: [],
      failOn: { table: 'lineups', op: 'update', code: '42501' },
    });
    const r = await setLineupFormationFromClient(client, {
      lineup_id: LINEUP,
      formation_code: '4-3-3',
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});
