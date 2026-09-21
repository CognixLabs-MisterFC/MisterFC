import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendDirectMessageFromClient,
  sendTeamMessageFromClient,
  type MessageFanOut,
} from '../send';
import type { Database } from '../../supabase/types';

/**
 * PUSH-ÁREA — la marca de audiencia del DM coach ↔ familia.
 *
 * `new_message` es el mixto de libro: el mismo type con las mismas claves en el
 * `data` llega al coach y a la familia, y quien envía es el ÚNICO que sabe de qué
 * lado está el que recibe. Sin marca, a un director-tutor el mensaje del entrenador
 * de su hija le abría la bandeja de DIRECCIÓN, donde ese hilo no está.
 *
 * Lo que se fija aquí es que la marca sale en los DOS payloads: el eager saca el
 * `data` del push del `in_app_payload` y el drenador del cron de la fila `push`.
 * Marcar solo uno pasaría estas pruebas a medias y fallaría en producción justo
 * cuando el envío inmediato no llega a enviarse.
 */

const CONV = 'eeeeeeee-0000-4000-8000-000000000001';
const COACH = 'dddddddd-0000-4000-8000-000000000001';
const TUTOR = 'dddddddd-0000-4000-8000-000000000002';
const PLAYER = 'aaaaaaaa-0000-4000-8000-000000000001';

type Term = { data?: unknown; error?: unknown; count?: number };

/** Mismo mock por tabla que usan create/staff-dm: cola de respuestas por tabla. */
function makeClient(responses: Record<string, Term[]>) {
  const next = (table: string): Term => {
    const arr = responses[table];
    if (!arr || arr.length === 0) throw new Error(`sin respuesta en cola para ${table}`);
    return arr.shift()!;
  };
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = chain;
    q.is = chain;
    q.in = chain;
    q.gte = chain;
    q.insert = chain;
    q.maybeSingle = () => Promise.resolve(next(table));
    q.single = () => Promise.resolve(next(table));
    q.then = (onF: (v: Term) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(onF, onR);
    return q;
  };
  return { from: (t: string) => build(t) } as unknown as SupabaseClient<Database>;
}

function capturingFanOut() {
  const calls: Array<Parameters<MessageFanOut>> = [];
  const fn: MessageFanOut = (recipients, payload) => {
    calls.push([recipients, payload]);
    return Promise.resolve(undefined);
  };
  return { fn, calls };
}

/** Colas de una conversación viva, sin rate limit y con el insert bien. */
function colas(extra: Record<string, Term[]> = {}): Record<string, Term[]> {
  return {
    conversations: [
      {
        data: {
          id: CONV,
          club_id: 'cccccccc-0000-4000-8000-000000000001',
          player_id: PLAYER,
          coach_profile_id: COACH,
        },
      },
    ],
    messages: [
      { count: 0 },
      {
        data: {
          id: 'ffffffff-0000-4000-8000-000000000001',
          sender_profile_id: COACH,
          body: 'hola',
          sent_at: '2026-09-21T10:00:00Z',
          read_at: null,
        },
      },
    ],
    ...extra,
  };
}

describe('sendDirectMessageFromClient — marca de audiencia', () => {
  it('coach → familia: los dos payloads salen marcados como family', async () => {
    const { fn, calls } = capturingFanOut();
    const client = makeClient(
      colas({ player_accounts: [{ data: [{ profile_id: TUTOR }] }] }),
    );

    const res = await sendDirectMessageFromClient(
      client,
      { conversationId: CONV, body: 'hola', senderId: COACH, senderName: 'Mister', locale: 'es' },
      fn,
    );

    expect('ok' in res).toBe(true);
    expect(calls).toHaveLength(1);
    const [recipients, payload] = calls[0]!;
    expect(recipients).toEqual([{ user_id: TUTOR }]);
    expect(payload.type).toBe('new_message');
    // La marca, en los DOS payloads. Si falta en el push, el drenador la pierde.
    expect(payload.in_app_payload).toMatchObject({ audience: 'family' });
    expect(payload.push_payload).toMatchObject({ audience: 'family' });
  });

  it('familia → coach: al coach le llega por su papel, marcado staff', async () => {
    const { fn, calls } = capturingFanOut();
    const client = makeClient(colas());

    const res = await sendDirectMessageFromClient(
      client,
      { conversationId: CONV, body: 'gracias', senderId: TUTOR, senderName: 'Padre', locale: 'es' },
      fn,
    );

    expect('ok' in res).toBe(true);
    expect(calls).toHaveLength(1);
    const [recipients, payload] = calls[0]!;
    expect(recipients).toEqual([{ user_id: COACH }]);
    expect(payload.in_app_payload).toMatchObject({ audience: 'staff' });
    expect(payload.push_payload).toMatchObject({ audience: 'staff' });
  });

  it('la marca no pisa lo que ya viajaba (ids y deep_link siguen ahí)', async () => {
    const { fn, calls } = capturingFanOut();
    const client = makeClient(colas());

    await sendDirectMessageFromClient(
      client,
      { conversationId: CONV, body: 'hey', senderId: TUTOR, senderName: 'Padre', locale: 'es' },
      fn,
    );

    const [, payload] = calls[0]!;
    expect(payload.in_app_payload).toMatchObject({
      conversation_id: CONV,
      sender_profile_id: TUTOR,
      deep_link: `/es/mensajes/${CONV}`,
    });
    expect(payload.push_payload).toMatchObject({
      tag: `conversation:${CONV}`,
      deep_link: `/es/mensajes/${CONV}`,
    });
  });
});

/**
 * PUSH-ÁREA — el chat de EQUIPO, con el papel de cada uno.
 *
 * Aquí no hay una audiencia sino tres a la vez (staff del equipo, familias del roster
 * y dirección con participación activa), así que el emisor parte el fan-out en un
 * envío por papel. El papel NO lo calcula este código: lo dice
 * `team_chat_member_roles` (migración 20261091000000), que ve el club entero en vez de
 * lo que la RLS deja ver al que envía.
 */
const TEAM_CONV = 'eeeeeeee-0000-4000-8000-000000000002';
const TEAM = 'bbbbbbbb-0000-4000-8000-000000000001';
const T_COACH = 'dddddddd-0000-4000-8000-000000000010';
const T_DIR = 'dddddddd-0000-4000-8000-000000000011';
const T_PADRE = 'dddddddd-0000-4000-8000-000000000012';

/** Mock que además responde a `rpc(nombre)` con lo que se le ponga en cola. */
function makeTeamClient(
  responses: Record<string, Term[]>,
  rpcs: Record<string, Term>,
) {
  const base = makeClient(responses) as unknown as {
    from: (t: string) => unknown;
  };
  return {
    from: base.from,
    rpc: (name: string) => Promise.resolve(rpcs[name] ?? { data: null, error: null }),
  } as unknown as SupabaseClient<Database>;
}

function colasEquipo(): Record<string, Term[]> {
  return {
    team_conversations: [
      { data: { id: TEAM_CONV, team_id: TEAM, teams: { name: 'Alevín A' } } },
    ],
    team_messages: [
      { count: 0 },
      {
        data: {
          id: 'ffffffff-0000-4000-8000-000000000002',
          sender_profile_id: T_COACH,
          body: 'entreno a las 18h',
          created_at: '2026-09-21T10:00:00Z',
        },
      },
    ],
  };
}

describe('sendTeamMessageFromClient — un envío por papel', () => {
  it('parte el fan-out en tres, cada uno con su marca', async () => {
    const { fn, calls } = capturingFanOut();
    const client = makeTeamClient(colasEquipo(), {
      team_chat_member_roles: {
        data: [
          { profile_id: T_COACH, audience: 'staff' },
          { profile_id: T_DIR, audience: 'direction' },
          { profile_id: T_PADRE, audience: 'family' },
        ],
      },
    });

    const res = await sendTeamMessageFromClient(
      client,
      { teamConversationId: TEAM_CONV, body: 'entreno a las 18h', senderId: 'otro', senderName: 'Mister', locale: 'es' },
      fn,
    );

    expect('ok' in res).toBe(true);
    expect(calls).toHaveLength(3);
    const porMarca = new Map(
      calls.map(([recipients, payload]) => [
        (payload.in_app_payload as { audience?: string }).audience,
        recipients.map((r) => r.user_id),
      ]),
    );
    expect(porMarca.get('staff')).toEqual([T_COACH]);
    expect(porMarca.get('direction')).toEqual([T_DIR]);
    expect(porMarca.get('family')).toEqual([T_PADRE]);
    // Y en los dos payloads, como en el resto de la serie.
    for (const [, payload] of calls) {
      expect(payload.push_payload).toHaveProperty('audience');
    }
  });

  it('agrupa: dos personas del mismo papel van en UN envío', async () => {
    const { fn, calls } = capturingFanOut();
    const client = makeTeamClient(colasEquipo(), {
      team_chat_member_roles: {
        data: [
          { profile_id: T_COACH, audience: 'staff' },
          { profile_id: T_DIR, audience: 'staff' },
        ],
      },
    });

    await sendTeamMessageFromClient(
      client,
      { teamConversationId: TEAM_CONV, body: 'hola', senderId: 'otro', senderName: 'M', locale: 'es' },
      fn,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]![0].map((r) => r.user_id)).toEqual([T_COACH, T_DIR]);
  });

  it('el emisor no se avisa a sí mismo', async () => {
    const { fn, calls } = capturingFanOut();
    const client = makeTeamClient(colasEquipo(), {
      team_chat_member_roles: {
        data: [
          { profile_id: T_COACH, audience: 'staff' },
          { profile_id: T_PADRE, audience: 'family' },
        ],
      },
    });

    await sendTeamMessageFromClient(
      client,
      { teamConversationId: TEAM_CONV, body: 'hola', senderId: T_COACH, senderName: 'M', locale: 'es' },
      fn,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]![0].map((r) => r.user_id)).toEqual([T_PADRE]);
  });

  it('RED DE SEGURIDAD: si la RPC nueva falla, se notifica como antes', async () => {
    // El caso que esto evita: la migración todavía no aplicada → la función no
    // existe → sin fallback, el chat de equipo se queda sin avisar a NADIE, y en
    // silencio. Con fallback, todos reciben; lo único que se pierde es la marca.
    const { fn, calls } = capturingFanOut();
    const client = makeTeamClient(colasEquipo(), {
      team_chat_member_roles: {
        data: null,
        error: { message: 'function public.team_chat_member_roles does not exist' },
      },
      team_chat_member_profile_ids: { data: [T_COACH, T_PADRE] },
    });

    const res = await sendTeamMessageFromClient(
      client,
      { teamConversationId: TEAM_CONV, body: 'hola', senderId: 'otro', senderName: 'M', locale: 'es' },
      fn,
    );

    expect('ok' in res).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].map((r) => r.user_id)).toEqual([T_COACH, T_PADRE]);
    // Sin marca: el push vuelve a abrir el hogar de cada uno, como antes de la serie.
    expect(calls[0]![1].in_app_payload).not.toHaveProperty('audience');
    expect(calls[0]![1].push_payload).not.toHaveProperty('audience');
  });
});
