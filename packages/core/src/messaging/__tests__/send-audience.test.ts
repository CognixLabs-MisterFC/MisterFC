import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendDirectMessageFromClient, type MessageFanOut } from '../send';
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
