import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listStaffDirectoryFromClient,
  startStaffConversationFromClient,
  sendStaffMessageFromClient,
  getStaffInboxFromClient,
  countUnreadStaffConversations,
  markStaffConversationReadFromClient,
  type StaffInboxItem,
} from '../staff-dm';
import type { MessageFanOut } from '../send';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';
const ME = 'dddddddd-0000-4000-8000-000000000001';
const OTHER = 'dddddddd-0000-4000-8000-000000000002';
const DIR = 'dddddddd-0000-4000-8000-000000000003';
const DELE = 'dddddddd-0000-4000-8000-000000000004';
const PLAYERPROF = 'dddddddd-0000-4000-8000-000000000005';
const CONV = 'eeeeeeee-0000-4000-8000-000000000001';

type Term = { data?: unknown; error?: unknown; count?: number };

/**
 * Cliente mock por tabla: cada `from(tabla)` consume la SIGUIENTE respuesta en cola
 * para esa tabla al llegar a un terminal (await / maybeSingle / single). q es
 * encadenable y "thenable". Cubre neq/gte además de los del test de create.
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
    q.neq = chain;
    q.is = chain;
    q.in = chain;
    q.gte = chain;
    q.order = chain;
    q.limit = chain;
    q.insert = chain;
    q.upsert = chain;
    q.maybeSingle = () => Promise.resolve(next(table));
    q.single = () => Promise.resolve(next(table));
    q.then = (onF: (v: Term) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(onF, onR);
    return q;
  };
  return { from: (table: string) => build(table) } as unknown as SupabaseClient<Database>;
}

const okFanOut: MessageFanOut = () => Promise.resolve(undefined);

/** Fan-out que captura sus llamadas (type-safe, sin vi.fn genéricos). */
function capturingFanOut() {
  const calls: Array<Parameters<MessageFanOut>> = [];
  const fn: MessageFanOut = (recipients, payload) => {
    calls.push([recipients, payload]);
    return Promise.resolve(undefined);
  };
  return { fn, calls };
}

describe('listStaffDirectoryFromClient', () => {
  it('une memberships de gestión y team_staff, excluye jugador y al propio usuario, rol canónico', async () => {
    const sb = makeClient({
      memberships: [
        {
          data: [
            { profile_id: DIR, role: 'director' },
            { profile_id: ME, role: 'entrenador_principal' }, // el propio → fuera
            { profile_id: PLAYERPROF, role: 'jugador' }, // jugador → fuera
          ],
        },
      ],
      team_staff: [
        {
          data: [
            { staff_role: 'delegado', memberships: { profile_id: DELE, club_id: CLUB } },
            // DIR también es ayudante en un equipo → rol canónico sigue siendo director
            { staff_role: 'entrenador_ayudante', memberships: { profile_id: DIR, club_id: CLUB } },
          ],
        },
      ],
      profiles: [
        {
          data: [
            { id: DIR, full_name: 'Ana Gómez' },
            { id: DELE, full_name: 'Zoe Ruiz' },
          ],
        },
      ],
    });

    const r = await listStaffDirectoryFromClient(sb, { clubId: CLUB, currentProfileId: ME });
    expect('staff' in r).toBe(true);
    if (!('staff' in r)) return;
    // Ordenado por nombre (Ana < Zoe); ME y PLAYERPROF fuera.
    expect(r.staff).toEqual([
      { profileId: DIR, fullName: 'Ana Gómez', role: 'director' },
      { profileId: DELE, fullName: 'Zoe Ruiz', role: 'delegado' },
    ]);
  });

  it('sin staff (aparte del propio) devuelve lista vacía sin pedir profiles', async () => {
    const sb = makeClient({
      memberships: [{ data: [{ profile_id: ME, role: 'admin_club' }] }],
      team_staff: [{ data: [] }],
      // profiles NO se consulta (ids vacío) → si se pidiera, el mock lanzaría.
    });
    const r = await listStaffDirectoryFromClient(sb, { clubId: CLUB, currentProfileId: ME });
    expect(r).toEqual({ staff: [] });
  });

  it('propaga error de lectura como generic', async () => {
    const sb = makeClient({
      memberships: [{ error: { message: 'boom' } }],
    });
    const r = await listStaffDirectoryFromClient(sb, { clubId: CLUB, currentProfileId: ME });
    expect(r).toEqual({ error: 'generic' });
  });
});

describe('startStaffConversationFromClient', () => {
  it('rechaza hilo consigo mismo', async () => {
    const sb = makeClient({});
    const r = await startStaffConversationFromClient(sb, {
      clubId: CLUB,
      currentProfileId: ME,
      otherProfileId: ME,
    });
    expect(r).toEqual({ error: 'self' });
  });

  it('reusa el hilo existente (idempotente)', async () => {
    const sb = makeClient({
      staff_conversations: [{ data: { id: CONV } }],
    });
    const r = await startStaffConversationFromClient(sb, {
      clubId: CLUB,
      currentProfileId: ME,
      otherProfileId: OTHER,
    });
    expect(r).toEqual({ ok: { conversationId: CONV } });
  });

  it('crea el hilo si no existe', async () => {
    const sb = makeClient({
      staff_conversations: [
        { data: null }, // no existe
        { data: { id: CONV } }, // insert
      ],
    });
    const r = await startStaffConversationFromClient(sb, {
      clubId: CLUB,
      currentProfileId: ME,
      otherProfileId: OTHER,
    });
    expect(r).toEqual({ ok: { conversationId: CONV } });
  });

  it('mapea 42501 a forbidden', async () => {
    const sb = makeClient({
      staff_conversations: [{ data: null }, { error: { code: '42501' } }],
    });
    const r = await startStaffConversationFromClient(sb, {
      clubId: CLUB,
      currentProfileId: ME,
      otherProfileId: OTHER,
    });
    expect(r).toEqual({ error: 'forbidden' });
  });

  it('ante carrera (23505) reintenta el SELECT y devuelve el existente', async () => {
    const sb = makeClient({
      staff_conversations: [
        { data: null }, // primer SELECT: no existe
        { error: { code: '23505' } }, // INSERT choca (otro lo creó)
        { data: { id: CONV } }, // re-SELECT: ya existe
      ],
    });
    const r = await startStaffConversationFromClient(sb, {
      clubId: CLUB,
      currentProfileId: ME,
      otherProfileId: OTHER,
    });
    expect(r).toEqual({ ok: { conversationId: CONV } });
  });
});

describe('sendStaffMessageFromClient', () => {
  const baseArgs = {
    conversationId: CONV,
    body: 'hola',
    senderId: ME,
    senderName: 'Yo',
    locale: 'es',
  };

  it('rechaza cuerpo vacío (invalid_payload) sin tocar BD', async () => {
    const sb = makeClient({});
    const r = await sendStaffMessageFromClient(sb, { ...baseArgs, body: '   ' }, okFanOut);
    expect(r).toEqual({ error: 'invalid_payload' });
  });

  it('conversación no visible → conversation_not_found', async () => {
    const sb = makeClient({ staff_conversations: [{ data: null }] });
    const r = await sendStaffMessageFromClient(sb, baseArgs, okFanOut);
    expect(r).toEqual({ error: 'conversation_not_found' });
  });

  it('rate limit alcanzado → rate_limited', async () => {
    const sb = makeClient({
      staff_conversations: [{ data: { id: CONV, profile_a: ME, profile_b: OTHER } }],
      staff_messages: [{ count: 30 }],
    });
    const r = await sendStaffMessageFromClient(sb, baseArgs, okFanOut);
    expect(r).toEqual({ error: 'rate_limited' });
  });

  it('envía y hace fan-out SOLO al otro participante, tipo new_message con push', async () => {
    const inserted = {
      id: 'msg-1',
      sender_profile_id: ME,
      body: 'hola',
      created_at: '2026-08-25T10:00:00.000Z',
    };
    const sb = makeClient({
      staff_conversations: [{ data: { id: CONV, profile_a: ME, profile_b: OTHER } }],
      staff_messages: [{ count: 0 }, { data: inserted }],
    });
    const { fn, calls } = capturingFanOut();
    const r = await sendStaffMessageFromClient(sb, baseArgs, fn);
    expect(r).toEqual({ ok: { message: inserted } });
    expect(calls).toHaveLength(1);
    const [recipients, payload] = calls[0]!;
    expect(recipients).toEqual([{ user_id: OTHER }]);
    expect(payload.type).toBe('new_message');
    expect(payload.push_payload.deep_link).toBe(`/es/mensajes/staff/${CONV}`);
    expect(payload.in_app_payload.staff_conversation_id).toBe(CONV);
  });

  it('el emisor puede ser profile_b: notifica a profile_a', async () => {
    const inserted = {
      id: 'msg-2',
      sender_profile_id: OTHER,
      body: 'hola',
      created_at: '2026-08-25T10:00:00.000Z',
    };
    const sb = makeClient({
      staff_conversations: [{ data: { id: CONV, profile_a: ME, profile_b: OTHER } }],
      staff_messages: [{ count: 0 }, { data: inserted }],
    });
    const { fn, calls } = capturingFanOut();
    await sendStaffMessageFromClient(sb, { ...baseArgs, senderId: OTHER }, fn);
    expect(calls[0]![0]).toEqual([{ user_id: ME }]);
  });

  it('mapea 42501 del insert a forbidden', async () => {
    const sb = makeClient({
      staff_conversations: [{ data: { id: CONV, profile_a: ME, profile_b: OTHER } }],
      staff_messages: [{ count: 0 }, { error: { code: '42501' } }],
    });
    const r = await sendStaffMessageFromClient(sb, baseArgs, okFanOut);
    expect(r).toEqual({ error: 'forbidden' });
  });

  it('un fallo del fan-out NO frena el envío (devuelve ok)', async () => {
    const inserted = {
      id: 'msg-3',
      sender_profile_id: ME,
      body: 'hola',
      created_at: '2026-08-25T10:00:00.000Z',
    };
    const sb = makeClient({
      staff_conversations: [{ data: { id: CONV, profile_a: ME, profile_b: OTHER } }],
      staff_messages: [{ count: 0 }, { data: inserted }],
    });
    const fanOut: MessageFanOut = () => Promise.reject(new Error('push down'));
    const r = await sendStaffMessageFromClient(sb, baseArgs, fanOut);
    expect(r).toEqual({ ok: { message: inserted } });
  });
});

describe('getStaffInboxFromClient + countUnreadStaffConversations', () => {
  it('lista sin hilos → vacío', async () => {
    const sb = makeClient({ staff_conversations: [{ data: [] }] });
    const items = await getStaffInboxFromClient(sb, ME);
    expect(items).toEqual([]);
  });

  it('resuelve el otro, deriva no-leídos por last_read_at y ordena por fecha', async () => {
    const CONV2 = 'eeeeeeee-0000-4000-8000-000000000002';
    const sb = makeClient({
      staff_conversations: [
        {
          data: [
            // más reciente primero (ya vendría ordenado de la query)
            { id: CONV2, profile_a: OTHER, profile_b: ME, last_message_at: '2026-08-25T12:00:00.000Z' },
            { id: CONV, profile_a: ME, profile_b: DIR, last_message_at: '2026-08-25T09:00:00.000Z' },
          ],
        },
      ],
      profiles: [
        {
          data: [
            { id: OTHER, full_name: 'Otro Staff' },
            { id: DIR, full_name: 'Ana Dir' },
          ],
        },
      ],
      staff_conversation_reads: [
        { data: [{ conversation_id: CONV, last_read_at: '2026-08-25T09:30:00.000Z' }] },
      ],
      staff_messages: [
        {
          data: [
            // CONV2: sin marca de lectura → ambos del otro cuentan
            { conversation_id: CONV2, created_at: '2026-08-25T11:00:00.000Z' },
            { conversation_id: CONV2, created_at: '2026-08-25T12:00:00.000Z' },
            // CONV: uno anterior a mi lectura (no cuenta), uno posterior (cuenta)
            { conversation_id: CONV, created_at: '2026-08-25T09:00:00.000Z' },
            { conversation_id: CONV, created_at: '2026-08-25T09:45:00.000Z' },
          ],
        },
      ],
    });

    const items = await getStaffInboxFromClient(sb, ME);
    expect(items).toEqual<StaffInboxItem[]>([
      {
        kind: 'staff',
        conversationId: CONV2,
        otherProfileId: OTHER,
        title: 'Otro Staff',
        lastMessageAt: '2026-08-25T12:00:00.000Z',
        unread: 2,
      },
      {
        kind: 'staff',
        conversationId: CONV,
        otherProfileId: DIR,
        title: 'Ana Dir',
        lastMessageAt: '2026-08-25T09:00:00.000Z',
        unread: 1,
      },
    ]);
    expect(countUnreadStaffConversations(items)).toBe(2);
  });

  it('countUnreadStaffConversations cuenta hilos con unread>0', () => {
    const items: StaffInboxItem[] = [
      { kind: 'staff', conversationId: 'a', otherProfileId: 'x', title: 'A', lastMessageAt: '', unread: 0 },
      { kind: 'staff', conversationId: 'b', otherProfileId: 'y', title: 'B', lastMessageAt: '', unread: 3 },
    ];
    expect(countUnreadStaffConversations(items)).toBe(1);
  });
});

describe('markStaffConversationReadFromClient', () => {
  it('upsert ok → { ok: true }', async () => {
    const sb = makeClient({ staff_conversation_reads: [{ error: null }] });
    const r = await markStaffConversationReadFromClient(sb, CONV, ME, '2026-08-25T10:00:00.000Z');
    expect(r).toEqual({ ok: true });
  });

  it('error de upsert → { ok: false }', async () => {
    const sb = makeClient({ staff_conversation_reads: [{ error: { message: 'boom' } }] });
    const r = await markStaffConversationReadFromClient(sb, CONV, ME, '2026-08-25T10:00:00.000Z');
    expect(r).toEqual({ ok: false });
  });
});
