import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendDirectMessageFromClient,
  sendTeamMessageFromClient,
  type MessageFanOut,
} from '../messaging/send';
import type { Database } from '../supabase/types';

/** Spy tipado con la firma de MessageFanOut (recipients, payload) → así mock.calls
 *  conserva la tupla de argumentos y podemos inspeccionar recipients/payload. */
function spyFanOut() {
  return vi.fn(
    (
      _recipients: Parameters<MessageFanOut>[0],
      _payload: Parameters<MessageFanOut>[1],
    ): ReturnType<MessageFanOut> => Promise.resolve(undefined),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock de SupabaseClient — un query-builder encadenable que devuelve valores
// preprogramados por tabla. Cubre lo que tocan las orquestaciones de envío.
// ─────────────────────────────────────────────────────────────────────────────

type TablePlan = {
  // fila devuelta por maybeSingle() (SELECT de la conversación)
  selectMaybeSingle?: { data: unknown };
  // { count } del SELECT head:true (rate limit)
  count?: number;
  // resultado del insert().select().single()
  insertSingle?: { data: unknown; error: { code?: string; message?: string } | null };
  // filas de player_accounts (SELECT .eq)
  selectRows?: unknown[];
};

function makeClient(opts: {
  tables: Record<string, TablePlan>;
  rpc?: Record<string, unknown[]>;
  onInsert?: (table: string) => void;
}): SupabaseClient<Database> {
  const plan = (table: string): TablePlan => opts.tables[table] ?? {};

  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    let headMode = false; // select(..., {count, head}) → await resuelve a {count}
    const chain = () => builder;
    for (const m of ['select', 'eq', 'gte', 'is', 'neq', 'in', 'order']) {
      builder[m] = (..._a: unknown[]) => {
        if (m === 'select' && (_a[1] as { head?: boolean } | undefined)?.head) {
          headMode = true;
        }
        return chain();
      };
    }
    builder.maybeSingle = async () => ({
      data: plan(table).selectMaybeSingle?.data ?? null,
    });
    // El builder es thenable: en head-mode resuelve a {count}; si no, a {data:rows}
    // (p.ej. player_accounts). Los SELECT con maybeSingle no usan esta vía.
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        headMode
          ? { count: plan(table).count ?? 0 }
          : { data: plan(table).selectRows ?? [] },
      );
    builder.insert = (_row: unknown) => {
      opts.onInsert?.(table);
      return {
        select: () => ({
          single: async () =>
            plan(table).insertSingle ?? { data: null, error: null },
        }),
      };
    };
    return builder;
  };

  return {
    from,
    rpc: async (name: string) => ({ data: opts.rpc?.[name] ?? [] }),
  } as unknown as SupabaseClient<Database>;
}

const okFanOut = spyFanOut();

// conversation_id debe ser UUID (sendMessageSchema); el resto son ids libres.
const CONV_ID = '11111111-1111-4111-8111-111111111111';
const DIRECT_ARGS = {
  conversationId: CONV_ID,
  body: 'Hola entrenador',
  senderId: 'coach-1',
  senderName: 'Coach Uno',
  locale: 'es',
};

describe('F3 · sendDirectMessageFromClient (1:1)', () => {
  it('participante → inserta como el usuario y dispara el fan-out DESPUÉS', async () => {
    const fanOut = spyFanOut();
    const client = makeClient({
      tables: {
        conversations: {
          selectMaybeSingle: {
            data: {
              id: 'conv-1',
              club_id: 'club-1',
              player_id: 'player-1',
              coach_profile_id: 'coach-1', // sender = coach → recipients = familia
            },
          },
        },
        messages: { count: 0, insertSingle: { data: { id: 'msg-1', sender_profile_id: 'coach-1', body: 'Hola entrenador', sent_at: '2026-01-01T00:00:00Z', read_at: null }, error: null } },
        player_accounts: { selectRows: [{ profile_id: 'fam-1' }, { profile_id: 'fam-2' }] },
      },
    });

    const res = await sendDirectMessageFromClient(client, DIRECT_ARGS, fanOut);

    expect(res).toEqual({
      ok: {
        message: {
          id: 'msg-1',
          sender_profile_id: 'coach-1',
          body: 'Hola entrenador',
          sent_at: '2026-01-01T00:00:00Z',
          read_at: null,
        },
      },
    });
    expect(fanOut).toHaveBeenCalledTimes(1);
    const [recipients, payload] = fanOut.mock.calls[0]!;
    expect(recipients).toEqual([{ user_id: 'fam-1' }, { user_id: 'fam-2' }]);
    expect(payload.dedupe_base_prefix).toBe('new_message:msg-1');
  });

  it('NO participante (RLS oculta la conversación) → not_found y fan-out NO se llama', async () => {
    const fanOut = spyFanOut();
    const client = makeClient({
      tables: { conversations: { selectMaybeSingle: { data: null } } },
    });

    const res = await sendDirectMessageFromClient(client, DIRECT_ARGS, fanOut);

    expect(res).toEqual({ error: 'conversation_not_found' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('insert rechazado por RLS (42501) → forbidden y fan-out NO se llama', async () => {
    const fanOut = spyFanOut();
    const client = makeClient({
      tables: {
        conversations: {
          selectMaybeSingle: {
            data: { id: 'conv-1', club_id: 'club-1', player_id: 'player-1', coach_profile_id: 'other-coach' },
          },
        },
        messages: { count: 0, insertSingle: { data: null, error: { code: '42501' } } },
      },
    });

    const res = await sendDirectMessageFromClient(client, DIRECT_ARGS, fanOut);

    expect(res).toEqual({ error: 'forbidden' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('rate limit alcanzado → rate_limited, sin insertar ni fan-out', async () => {
    const fanOut = spyFanOut();
    const onInsert = vi.fn();
    const client = makeClient({
      tables: {
        conversations: { selectMaybeSingle: { data: { id: 'conv-1', club_id: 'c', player_id: 'p', coach_profile_id: 'coach-1' } } },
        messages: { count: 30 },
      },
      onInsert,
    });

    const res = await sendDirectMessageFromClient(client, DIRECT_ARGS, fanOut);

    expect(res).toEqual({ error: 'rate_limited' });
    expect(onInsert).not.toHaveBeenCalled();
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('cuerpo vacío → invalid_payload', async () => {
    const res = await sendDirectMessageFromClient(
      makeClient({ tables: {} }),
      { ...DIRECT_ARGS, body: '   ' },
      okFanOut,
    );
    expect(res).toEqual({ error: 'invalid_payload' });
  });
});

const TEAM_ARGS = {
  teamConversationId: 'tc-1',
  body: 'Vamos equipo',
  senderId: 'fam-1',
  senderName: 'Familia Uno',
  locale: 'es',
};

describe('F3 · sendTeamMessageFromClient (equipo)', () => {
  it('miembro → inserta como el usuario + fan-out a los demás (sin el emisor)', async () => {
    const fanOut = spyFanOut();
    const client = makeClient({
      tables: {
        team_conversations: {
          selectMaybeSingle: { data: { id: 'tc-1', team_id: 'team-1', teams: { name: 'Alevín A' } } },
        },
        team_messages: { count: 0, insertSingle: { data: { id: 'tm-1', sender_profile_id: 'fam-1', body: 'Vamos equipo', created_at: '2026-01-01T00:00:00Z' }, error: null } },
      },
      rpc: { team_chat_member_profile_ids: ['fam-1', 'coach-1', 'fam-2'] },
    });

    const res = await sendTeamMessageFromClient(client, TEAM_ARGS, fanOut);

    expect('ok' in res && res.ok.teamId).toBe('team-1');
    expect('ok' in res && res.ok.message.id).toBe('tm-1');
    expect(fanOut).toHaveBeenCalledTimes(1);
    const [recipients] = fanOut.mock.calls[0]!;
    // el emisor (fam-1) queda excluido
    expect(recipients).toEqual([{ user_id: 'coach-1' }, { user_id: 'fam-2' }]);
  });

  it('NO miembro (RLS oculta el hilo) → not_found y fan-out NO se llama', async () => {
    const fanOut = spyFanOut();
    const client = makeClient({
      tables: { team_conversations: { selectMaybeSingle: { data: null } } },
    });

    const res = await sendTeamMessageFromClient(client, TEAM_ARGS, fanOut);

    expect(res).toEqual({ error: 'conversation_not_found' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('insert 42501 → forbidden y fan-out NO se llama', async () => {
    const fanOut = spyFanOut();
    const client = makeClient({
      tables: {
        team_conversations: { selectMaybeSingle: { data: { id: 'tc-1', team_id: 'team-1', teams: { name: 'A' } } } },
        team_messages: { count: 0, insertSingle: { data: null, error: { code: '42501' } } },
      },
    });

    const res = await sendTeamMessageFromClient(client, TEAM_ARGS, fanOut);

    expect(res).toEqual({ error: 'forbidden' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('cuerpo > 2000 → invalid_payload', async () => {
    const res = await sendTeamMessageFromClient(
      makeClient({ tables: {} }),
      { ...TEAM_ARGS, body: 'x'.repeat(2001) },
      okFanOut,
    );
    expect(res).toEqual({ error: 'invalid_payload' });
  });
});
