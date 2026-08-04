import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  startConversationFromClient,
  createTeamConversationFromClient,
  listMessageablePlayersFromClient,
} from '../create';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';
const OTHER_CLUB = 'cccccccc-0000-4000-8000-000000000002';
const PLAYER = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEAM = 'bbbbbbbb-0000-4000-8000-000000000001';
const COACH = 'dddddddd-0000-4000-8000-000000000001';

type Term = { data?: unknown; error?: unknown };

/**
 * Cliente mock por tabla: cada `from(tabla)` consume la SIGUIENTE respuesta en cola
 * para esa tabla en el orden en que se llama a un terminal (await / maybeSingle /
 * single). q es encadenable (select/eq/is/in/order/limit/insert → q) y "thenable"
 * (await q → terminal), así cubrimos tanto `.maybeSingle()` como `await …limit()`.
 */
function makeClient(responses: Record<string, Term[]>) {
  const next = (table: string): Term => {
    const arr = responses[table];
    if (!arr || arr.length === 0) {
      throw new Error(`sin respuesta en cola para ${table}`);
    }
    return arr.shift()!;
  };
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = chain;
    q.is = chain;
    q.in = chain;
    q.order = chain;
    q.limit = chain;
    q.insert = chain;
    q.maybeSingle = () => Promise.resolve(next(table));
    q.single = () => Promise.resolve(next(table));
    q.then = (onF: (v: Term) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(onF, onR);
    return q;
  };
  return {
    from: (table: string) => build(table),
  } as unknown as SupabaseClient<Database>;
}

describe('startConversationFromClient (1:1 — staff inicia)', () => {
  it('reusa la conversación existente (idempotente)', async () => {
    const sb = makeClient({
      players: [{ data: { id: PLAYER, club_id: CLUB } }],
      conversations: [{ data: { id: 'conv-existente' } }],
    });
    const r = await startConversationFromClient(sb, {
      clubId: CLUB,
      playerId: PLAYER,
      coachProfileId: COACH,
    });
    expect(r).toEqual({ ok: { conversationId: 'conv-existente' } });
  });

  it('crea una conversación nueva cuando no existe', async () => {
    const sb = makeClient({
      players: [{ data: { id: PLAYER, club_id: CLUB } }],
      conversations: [{ data: null }, { data: { id: 'conv-nueva' } }],
    });
    const r = await startConversationFromClient(sb, {
      clubId: CLUB,
      playerId: PLAYER,
      coachProfileId: COACH,
    });
    expect(r).toEqual({ ok: { conversationId: 'conv-nueva' } });
  });

  it('rechaza si el jugador es de otro club', async () => {
    const sb = makeClient({
      players: [{ data: { id: PLAYER, club_id: OTHER_CLUB } }],
    });
    const r = await startConversationFromClient(sb, {
      clubId: CLUB,
      playerId: PLAYER,
      coachProfileId: COACH,
    });
    expect(r).toEqual({ error: 'player_not_in_club' });
  });

  it('GATE server-side: la RLS rechaza el INSERT (42501) → forbidden', async () => {
    const sb = makeClient({
      players: [{ data: { id: PLAYER, club_id: CLUB } }],
      conversations: [{ data: null }, { data: null, error: { code: '42501' } }],
    });
    const r = await startConversationFromClient(sb, {
      clubId: CLUB,
      playerId: PLAYER,
      coachProfileId: COACH,
    });
    expect(r).toEqual({ error: 'forbidden' });
  });
});

describe('createTeamConversationFromClient (chat de equipo — staff inicia)', () => {
  it('reusa el hilo de equipo existente (idempotente)', async () => {
    const sb = makeClient({
      team_conversations: [{ data: { id: 'tc-existente' } }],
    });
    const r = await createTeamConversationFromClient(sb, { clubId: CLUB, teamId: TEAM });
    expect(r).toEqual({ ok: { conversationId: 'tc-existente' } });
  });

  it('crea el hilo de equipo cuando no existe', async () => {
    const sb = makeClient({
      team_conversations: [{ data: null }, { data: { id: 'tc-nuevo' } }],
    });
    const r = await createTeamConversationFromClient(sb, { clubId: CLUB, teamId: TEAM });
    expect(r).toEqual({ ok: { conversationId: 'tc-nuevo' } });
  });

  it('GATE server-side: la RLS rechaza el INSERT (42501) → forbidden', async () => {
    const sb = makeClient({
      team_conversations: [{ data: null }, { data: null, error: { code: '42501' } }],
    });
    const r = await createTeamConversationFromClient(sb, { clubId: CLUB, teamId: TEAM });
    expect(r).toEqual({ error: 'forbidden' });
  });
});

describe('listMessageablePlayersFromClient (selector de destinatario)', () => {
  it('devuelve los jugadores del club para el selector', async () => {
    const sb = makeClient({
      players: [
        {
          data: [
            { id: PLAYER, first_name: 'Ana', last_name: 'García' },
            { id: 'p2', first_name: 'Luis', last_name: null },
          ],
        },
      ],
    });
    const r = await listMessageablePlayersFromClient(sb, CLUB);
    expect(r).toEqual({
      players: [
        { id: PLAYER, first_name: 'Ana', last_name: 'García' },
        { id: 'p2', first_name: 'Luis', last_name: null },
      ],
    });
  });
});
