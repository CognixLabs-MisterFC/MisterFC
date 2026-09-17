import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  STAFF_ROLE_PRIORITY,
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

/**
 * Cliente mock para lo que va por RPC. Aparte de `makeClient` a propósito: aquel
 * encola por TABLA y esta lectura ya no toca ninguna. No tiene `from`, así que si
 * alguien volviera a armar el directorio con consultas, el test revienta.
 */
function makeRpcClient(rpcs: Record<string, Term[]>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      const arr = rpcs[fn];
      if (!arr || arr.length === 0) {
        throw new Error(`sin respuesta en cola para la RPC ${fn}`);
      }
      return Promise.resolve(arr.shift()!);
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe('listStaffDirectoryFromClient', () => {
  it('pide el directorio a la RPC, con el club, y no lee ninguna tabla', async () => {
    const { client, calls } = makeRpcClient({
      staff_conversation_directory: [
        {
          data: [
            { profile_id: DIR, full_name: 'Ana Gómez', role: 'director' },
            { profile_id: DELE, full_name: 'Zoe Ruiz', role: 'delegado' },
          ],
        },
      ],
    });
    const r = await listStaffDirectoryFromClient(client, CLUB);
    expect(r).toEqual({
      staff: [
        { profileId: DIR, fullName: 'Ana Gómez', role: 'director' },
        { profileId: DELE, fullName: 'Zoe Ruiz', role: 'delegado' },
      ],
    });
    expect(calls).toEqual([
      { fn: 'staff_conversation_directory', args: { p_club_id: CLUB } },
    ]);
  });

  it('respeta el orden que llega del servidor y no reordena', async () => {
    // El orden lo fija la RPC (unaccent+lower, desempate por id) porque aquí no se
    // puede desempatar: en el club real hay cuatro personas con el mismo nombre.
    const { client } = makeRpcClient({
      staff_conversation_directory: [
        {
          data: [
            { profile_id: DELE, full_name: 'Jose Coach', role: 'delegado' },
            { profile_id: DIR, full_name: 'Jose Coach', role: 'director' },
          ],
        },
      ],
    });
    const r = await listStaffDirectoryFromClient(client, CLUB);
    if (!('staff' in r)) throw new Error('esperaba staff');
    expect(r.staff.map((e) => e.profileId)).toEqual([DELE, DIR]);
  });

  it('un directorio vacío es una respuesta, no un fallo', async () => {
    const { client } = makeRpcClient({ staff_conversation_directory: [{ data: [] }] });
    expect(await listStaffDirectoryFromClient(client, CLUB)).toEqual({ staff: [] });
  });

  it('si la RPC falla, devuelve generic y lo apunta', async () => {
    const { client } = makeRpcClient({
      staff_conversation_directory: [{ data: null, error: { message: 'forbidden' } }],
    });
    const anotado: Array<{ step: string; extra: Record<string, unknown> }> = [];
    const r = await listStaffDirectoryFromClient(client, CLUB, (_e, step, extra) =>
      anotado.push({ step, extra }),
    );
    expect(r).toEqual({ error: 'generic' });
    expect(anotado).toEqual([{ step: 'staff_directory', extra: { club_id: CLUB } }]);
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

/**
 * La PRIORIDAD de rol vive en dos sitios a propósito: en el SQL para colapsar los
 * varios roles de una persona en uno, y aquí para ordenar las secciones de las dos
 * pantallas. Lo que no puede pasar es que se separen — si el SQL mete un rol nuevo y
 * esta lista no, la sección de esa gente no se pinta y nadie se entera. Así que se
 * comparan contra el fichero.
 *
 * Lo que NO se duplica es la regla de QUIÉN es staff: eso solo existe en
 * `profile_is_staff_of_club`, dentro de la RPC.
 */
describe('contrato con la migración 20261083000000', () => {
  function findMigration(): string {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = join(
        dir,
        'supabase/migrations/20261083000000_directorio_staff_desde_el_predicado.sql',
      );
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`no encuentro la migración del directorio subiendo desde ${process.cwd()}`);
  }

  it('la prioridad de rol del SQL es exactamente la de core, y en el mismo orden', () => {
    const sql = findMigration();
    const tabla = sql.slice(
      sql.indexOf('with prioridad(rol, orden) as ('),
      sql.indexOf('candidatos as ('),
    );
    expect(tabla).not.toBe('');

    // ('admin_club', 1) → ['admin_club', 1] en el orden en que aparecen.
    const filas = [...tabla.matchAll(/\('([a-z_]+)',\s*(\d+)\)/g)].map((m) => ({
      rol: m[1],
      orden: Number(m[2]),
    }));

    expect(filas.map((f) => f.rol)).toEqual([...STAFF_ROLE_PRIORITY]);
    // Y que el número diga lo mismo que el orden de la lista: una tabla con los roles
    // bien pero los números permutados colapsaría al rol equivocado.
    expect(filas.map((f) => f.orden)).toEqual(filas.map((_f, i) => i + 1));
  });
});
