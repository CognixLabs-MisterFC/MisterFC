import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPostMatchFromClient,
  upsertEvaluationFromClient,
  deleteEvaluationFromClient,
  setPostMatchDoneFromClient,
  upsertTeamEvaluationFromClient,
  deleteTeamEvaluationFromClient,
} from '../post-match';
import type { Database } from '../../supabase/types';

const EVENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLUB = 'cccccccc-0000-4000-8000-000000000001';
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const P2 = 'dddddddd-0000-4000-8000-000000000002';

type PgErr = { code?: string; message?: string } | null;
type Call = { table: string; op: string; payload?: unknown };

type Opts = {
  user?: { id: string } | null;
  canRecord?: boolean;
  event?: unknown;
  matchState?: unknown;
  stats?: unknown[];
  evals?: unknown[];
  players?: unknown[];
  teamEval?: unknown;
  /** Filas que devuelve el UPDATE...select (decide update vs insert). */
  updateReturns?: Record<string, unknown[]>;
  /** Inyecta un error en (table, op). */
  failOn?: { table: string; op: string; code?: string; message?: string };
};

function makeClient(opts: Opts) {
  const calls: Call[] = [];
  const user = opts.user === undefined ? { id: 'u-1' } : opts.user;

  const singleFor = (table: string): { data: unknown; error: PgErr } => {
    switch (table) {
      case 'events':
        return {
          data:
            opts.event === undefined
              ? {
                  id: EVENT,
                  club_id: CLUB,
                  type: 'match',
                  title: 'vs Rival',
                  opponent_name: 'Rival',
                  teams: { name: 'Alevín A', color: '#111', format: 'f7' },
                }
              : opts.event,
          error: null,
        };
      case 'match_state':
        return { data: opts.matchState ?? null, error: null };
      case 'team_evaluations':
        return { data: opts.teamEval ?? null, error: null };
      default:
        return { data: null, error: null };
    }
  };

  const listFor = (table: string): unknown[] => {
    switch (table) {
      case 'match_player_stats':
        return opts.stats ?? [];
      case 'evaluations':
        return opts.evals ?? [];
      case 'players':
        return opts.players ?? [];
      default:
        return [];
    }
  };

  class QB {
    table: string;
    op = 'select';
    selected = false;
    constructor(table: string) {
      this.table = table;
    }
    select() {
      this.selected = true;
      return this;
    }
    insert(payload: unknown) {
      this.op = 'insert';
      calls.push({ table: this.table, op: 'insert', payload });
      return this;
    }
    update(payload: unknown) {
      this.op = 'update';
      calls.push({ table: this.table, op: 'update', payload });
      return this;
    }
    delete() {
      this.op = 'delete';
      calls.push({ table: this.table, op: 'delete' });
      return this;
    }
    eq() {
      return this;
    }
    neq() {
      return this;
    }
    in() {
      return this;
    }
    private injected(): PgErr {
      const f = opts.failOn;
      if (f && f.table === this.table && f.op === this.op) {
        return { code: f.code, message: f.message };
      }
      return null;
    }
    maybeSingle() {
      return Promise.resolve(singleFor(this.table));
    }
    // Thenable: resuelve según la operación.
    then(resolve: (v: { data: unknown; error: PgErr }) => unknown) {
      const err = this.injected();
      if (this.op === 'select') {
        return Promise.resolve(resolve({ data: listFor(this.table), error: null }));
      }
      if (this.op === 'update' && this.selected) {
        // UPDATE ... select(): filas afectadas (para decidir update vs insert).
        return Promise.resolve(
          resolve({ data: err ? null : (opts.updateReturns?.[this.table] ?? []), error: err }),
        );
      }
      // update sin select (MVP clear), insert, delete → solo {error}.
      return Promise.resolve(resolve({ data: null, error: err }));
    }
  }

  const client = {
    from(table: string) {
      return new QB(table);
    },
    rpc(fn: string) {
      expect(fn).toBe('user_can_record_match');
      return Promise.resolve({ data: opts.canRecord ?? true, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user }, error: null }),
    },
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('getPostMatchFromClient (read)', () => {
  it('ensambla resultado + stats + valoraciones + jugadores ordenados', async () => {
    const { client } = makeClient({
      matchState: { status: 'closed', post_match_done: false, goals_for: 3, goals_against: 1 },
      stats: [
        { player_id: P1, started: true, minutes_played: 60, goals: 2, assists: 0, yellow_cards: 0, red_cards: 0, shots: 3, fouls_committed: 1, fouls_received: 2, penalties_scored: 0, penalties_missed: 0 },
        { player_id: P2, started: false, minutes_played: 20, goals: 0, assists: 1, yellow_cards: 1, red_cards: 0, shots: 0, fouls_committed: 0, fouls_received: 0, penalties_scored: 0, penalties_missed: 0 },
      ],
      evals: [{ player_id: P1, rating: 8, comment: 'crack', is_mvp: true }],
      players: [
        { id: P2, first_name: 'Beto', last_name: 'Zeta', dorsal: 20 },
        { id: P1, first_name: 'Ana', last_name: 'Alfa', dorsal: 7 },
      ],
      teamEval: { rating: 7, comment: 'bien' },
    });
    const r = await getPostMatchFromClient(client, CLUB, EVENT);
    expect(r).not.toBeNull();
    expect(r!.matchStatus).toBe('closed');
    expect(r!.score).toEqual({ own: 3, against: 1 });
    expect(r!.canRecord).toBe(true);
    expect(r!.teamEvaluation).toEqual({ rating: 7, comment: 'bien' });
    // Orden: titular (P1) antes que suplente (P2).
    expect(r!.players.map((p) => p.playerId)).toEqual([P1, P2]);
    expect(r!.players[0]!.evaluation).toEqual({ rating: 8, comment: 'crack', isMvp: true });
    expect(r!.players[0]!.stats!.goals).toBe(2);
    expect(r!.players[1]!.evaluation).toBeNull();
  });

  it('evento inexistente → null', async () => {
    const { client } = makeClient({ event: null });
    expect(await getPostMatchFromClient(client, CLUB, EVENT)).toBeNull();
  });

  it('canRecord=false cuando la RLS no autoriza', async () => {
    const { client } = makeClient({ canRecord: false, matchState: { status: 'closed', post_match_done: false, goals_for: 0, goals_against: 0 } });
    const r = await getPostMatchFromClient(client, CLUB, EVENT);
    expect(r!.canRecord).toBe(false);
  });
});

describe('upsertEvaluationFromClient (valoración individual)', () => {
  const goodInput = { event_id: EVENT, player_id: P1, rating: 8, comment: 'bien', is_mvp: false };

  it('sin fila previa → INSERT', async () => {
    const { client, calls } = makeClient({ updateReturns: { evaluations: [] } });
    const r = await upsertEvaluationFromClient(client, goodInput);
    expect(r).toEqual({ ok: true });
    expect(calls.some((c) => c.table === 'evaluations' && c.op === 'insert')).toBe(true);
  });

  it('con fila previa → UPDATE, sin INSERT', async () => {
    const { client, calls } = makeClient({ updateReturns: { evaluations: [{ player_id: P1 }] } });
    const r = await upsertEvaluationFromClient(client, goodInput);
    expect(r).toEqual({ ok: true });
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('MVP → desmarca al anterior antes (update is_mvp=false)', async () => {
    const { client, calls } = makeClient({ updateReturns: { evaluations: [{ player_id: P1 }] } });
    await upsertEvaluationFromClient(client, { ...goodInput, is_mvp: true });
    const updates = calls.filter((c) => c.table === 'evaluations' && c.op === 'update');
    // 1er update = clear MVP (is_mvp:false), 2º = la fila del jugador.
    expect(updates.length).toBe(2);
    expect(updates[0]!.payload).toMatchObject({ is_mvp: false });
  });

  it('RLS 42501 → forbidden', async () => {
    const { client } = makeClient({ failOn: { table: 'evaluations', op: 'update', code: '42501' } });
    const r = await upsertEvaluationFromClient(client, goodInput);
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('trigger rating_required_for_match → rating_required', async () => {
    const { client } = makeClient({
      updateReturns: { evaluations: [] },
      failOn: { table: 'evaluations', op: 'insert', message: 'rating_required_for_match' },
    });
    const r = await upsertEvaluationFromClient(client, goodInput);
    expect(r).toEqual({ ok: false, error: 'rating_required' });
  });

  it('trigger empty_evaluation → empty', async () => {
    const { client } = makeClient({
      updateReturns: { evaluations: [] },
      failOn: { table: 'evaluations', op: 'insert', message: 'empty_evaluation' },
    });
    const r = await upsertEvaluationFromClient(client, goodInput);
    expect(r).toEqual({ ok: false, error: 'empty' });
  });

  it('MVP tomado (índice parcial) → mvp_taken', async () => {
    const { client } = makeClient({
      updateReturns: { evaluations: [{ player_id: P1 }] },
      failOn: { table: 'evaluations', op: 'update', message: 'evaluations_one_mvp_per_event' },
    });
    const r = await upsertEvaluationFromClient(client, { ...goodInput, is_mvp: false });
    expect(r).toEqual({ ok: false, error: 'mvp_taken' });
  });

  it('input inválido (rating fuera de 1-10) → invalid', async () => {
    const { client } = makeClient({});
    const r = await upsertEvaluationFromClient(client, { ...goodInput, rating: 99 });
    expect(r).toEqual({ ok: false, error: 'invalid' });
  });

  it('sin sesión → unauthenticated', async () => {
    const { client } = makeClient({ user: null });
    const r = await upsertEvaluationFromClient(client, goodInput);
    expect(r).toEqual({ ok: false, error: 'unauthenticated' });
  });
});

describe('setPostMatchDoneFromClient', () => {
  it('partido closed → ok', async () => {
    const { client } = makeClient({ matchState: { status: 'closed' } });
    const r = await setPostMatchDoneFromClient(client, { event_id: EVENT, done: true });
    expect(r).toEqual({ ok: true });
  });

  it('partido no closed → not_closed', async () => {
    const { client } = makeClient({ matchState: { status: 'live' } });
    const r = await setPostMatchDoneFromClient(client, { event_id: EVENT, done: true });
    expect(r).toEqual({ ok: false, error: 'not_closed' });
  });

  it('RLS 42501 al actualizar → forbidden', async () => {
    const { client } = makeClient({
      matchState: { status: 'closed' },
      failOn: { table: 'match_state', op: 'update', code: '42501' },
    });
    const r = await setPostMatchDoneFromClient(client, { event_id: EVENT, done: true });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('team eval + delete', () => {
  it('upsertTeam sin fila → INSERT', async () => {
    const { client, calls } = makeClient({ updateReturns: { team_evaluations: [] } });
    const r = await upsertTeamEvaluationFromClient(client, { event_id: EVENT, rating: 7, comment: null });
    expect(r).toEqual({ ok: true });
    expect(calls.some((c) => c.table === 'team_evaluations' && c.op === 'insert')).toBe(true);
  });

  it('deleteEvaluation ok', async () => {
    const { client, calls } = makeClient({});
    const r = await deleteEvaluationFromClient(client, { event_id: EVENT, player_id: P1 });
    expect(r).toEqual({ ok: true });
    expect(calls.some((c) => c.table === 'evaluations' && c.op === 'delete')).toBe(true);
  });

  it('deleteTeam RLS 42501 → forbidden', async () => {
    const { client } = makeClient({ failOn: { table: 'team_evaluations', op: 'delete', code: '42501' } });
    const r = await deleteTeamEvaluationFromClient(client, { event_id: EVENT });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});
