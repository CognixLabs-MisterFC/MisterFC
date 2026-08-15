import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  profileScopedCacheKey,
  eventScopedCacheKey,
} from '../offline/read-cache';
import {
  getInboxFromClient,
  getConversationMessagesFromClient,
  getTeamMessagesFromClient,
  markConversationReadFromClient,
  markTeamConversationReadFromClient,
} from '../messaging/queries';

type TableResult = { data?: unknown[] };

/** Mock table-aware con soporte de `rpc` y `upsert` (misma data por tabla). */
function client(
  tables: Record<string, TableResult>,
  rpcs: Record<string, unknown[]> = {},
): SupabaseClient<Database> {
  const res = (t: string): TableResult => tables[t] ?? { data: [] };
  function builder(table: string) {
    const r = res(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'is', 'neq', 'update', 'upsert']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (f: (v: TableResult) => unknown) =>
      Promise.resolve(r).then(f);
    return chain;
  }
  return {
    from: (t: string) => builder(t),
    rpc: (name: string) => Promise.resolve({ data: rpcs[name] ?? [] }),
  } as unknown as SupabaseClient<Database>;
}

describe('E2a · keys de caché', () => {
  it('inbox profile-scoped; hilos por id (thread / team-thread)', () => {
    expect(profileScopedCacheKey('inbox', 'U1')).toBe('inbox.U1');
    expect(profileScopedCacheKey('inbox', 'U1')).not.toBe(profileScopedCacheKey('inbox', 'U2'));
    expect(eventScopedCacheKey('thread', 'C1')).toBe('thread.C1');
    expect(eventScopedCacheKey('thread', 'C1')).not.toBe(eventScopedCacheKey('thread', 'C2'));
    expect(eventScopedCacheKey('team-thread', 'TC1')).toBe('team-thread.TC1');
  });
});

describe('E2a · getInboxFromClient', () => {
  it('fusiona 1:1 + equipo con no-leídos y ordena por actividad reciente', async () => {
    const sb = client(
      {
        conversations: {
          data: [
            {
              id: 'C1', last_message_at: '2026-08-01T10:00:00Z', coach_profile_id: 'coach',
              players: { id: 'P1', first_name: 'Leo', last_name: 'Díaz' },
            },
          ],
        },
        // 2 no-leídos para C1 (recibidos, no propios).
        messages: { data: [{ conversation_id: 'C1' }, { conversation_id: 'C1' }] },
        team_conversations: {
          data: [
            { id: 'TC1', team_id: 'T1', last_message_at: '2026-08-02T10:00:00Z', teams: { name: 'Infantil A' } },
          ],
        },
      },
      { team_chat_unread_counts: [{ team_conversation_id: 'TC1', unread: 3 }] },
    );
    const inbox = await getInboxFromClient(sb, 'U1');
    expect(inbox).toHaveLength(2);
    // El grupo (2026-08-02) es más reciente que el 1:1 (2026-08-01) → primero.
    expect(inbox[0]!.kind).toBe('group');
    if (inbox[0]!.kind === 'group') {
      expect(inbox[0]!.teamConversationId).toBe('TC1');
      expect(inbox[0]!.unread).toBe(3);
      expect(inbox[0]!.title).toBe('Infantil A');
    }
    expect(inbox[1]!.kind).toBe('direct');
    if (inbox[1]!.kind === 'direct') {
      expect(inbox[1]!.conversationId).toBe('C1');
      expect(inbox[1]!.unread).toBe(2);
    }
  });

  it('inbox vacío → []', async () => {
    expect(await getInboxFromClient(client({}), 'U1')).toEqual([]);
  });
});

describe('E2a · fetch de hilos', () => {
  it('1:1 devuelve los mensajes tal cual (orden por sent_at)', async () => {
    const sb = client({
      messages: {
        data: [
          { id: 'm1', sender_profile_id: 'coach', body: 'Hola', sent_at: '2026-08-01T10:00:00Z', read_at: null },
        ],
      },
    });
    const msgs = await getConversationMessagesFromClient(sb, 'C1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toBe('Hola');
  });

  it('equipo mapea el nombre del emisor desde profiles', async () => {
    const sb = client({
      team_messages: {
        data: [
          { id: 'tm1', sender_profile_id: 'coach', body: 'Equipo', created_at: '2026-08-01T10:00:00Z', profiles: { full_name: 'Ana Coach' } },
        ],
      },
    });
    const msgs = await getTeamMessagesFromClient(sb, 'TC1');
    expect(msgs[0]!.sender_name).toBe('Ana Coach');
    expect(msgs[0]!.body).toBe('Equipo');
  });
});

describe('E2a · marcar leído', () => {
  it('1:1 y equipo devuelven ok (escritura permitida por RLS)', async () => {
    const sb = client({ messages: { data: [] }, team_conversation_reads: { data: [] } });
    expect(await markConversationReadFromClient(sb, 'C1', 'U1', '2026-08-01T00:00:00Z')).toEqual({ ok: true });
    expect(await markTeamConversationReadFromClient(sb, 'TC1', 'U1', '2026-08-01T00:00:00Z')).toEqual({ ok: true });
  });
});
