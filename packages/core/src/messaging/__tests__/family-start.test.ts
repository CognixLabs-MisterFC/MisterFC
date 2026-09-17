import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getFamilyRecipientsFromClient,
  startFamilyConversationFromClient,
} from '../family-start';
import type { Database } from '../../supabase/types';

/**
 * Lo que se protege aquí es la distinción que la pantalla no puede inventarse:
 *
 *   · lista vacía        → el club no tiene dirección y el jugador no tiene equipo.
 *                          Es una respuesta LEGÍTIMA y se pinta como tal,
 *   · forbidden          → quien mira no es de esta familia,
 *   · no_session         → no hay sesión; es otra cosa y otro arreglo,
 *   · error              → se rompió algo, y hay que DECIRLO.
 *
 * Si las cuatro colapsan en un array vacío, un fallo de lectura se disfraza de «no
 * hay a quién escribir» — que es exactamente el punto ciego que acabamos de arreglar
 * en el selector del staff.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

function makeClient(byFn: Record<string, RpcResult>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const sb = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(byFn[fn] ?? { data: null, error: { message: 'sin mock' } });
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, calls };
}

const PLAYER = 'player-1';

const FILA_EQUIPO = {
  profile_id: 'mister-1',
  full_name: 'Ana Pérez',
  kind: 'team',
  staff_role: 'entrenador_principal',
  team_id: 'team-1',
  team_name: 'Cadete A',
  conversation_id: 'conv-1',
};

const FILA_CLUB = {
  profile_id: 'dir-1',
  full_name: 'Luis Gil',
  kind: 'club',
  staff_role: 'director',
  team_id: null,
  team_name: null,
  conversation_id: null,
};

describe('getFamilyRecipientsFromClient', () => {
  it('mapea las dos clases de destinatario', async () => {
    const { sb, calls } = makeClient({
      family_conversation_recipients: { data: [FILA_EQUIPO, FILA_CLUB], error: null },
    });

    const r = await getFamilyRecipientsFromClient(sb, PLAYER);

    expect(r).toEqual({
      ok: true,
      recipients: [
        {
          profileId: 'mister-1',
          fullName: 'Ana Pérez',
          kind: 'team',
          staffRole: 'entrenador_principal',
          teamId: 'team-1',
          teamName: 'Cadete A',
          conversationId: 'conv-1',
        },
        {
          profileId: 'dir-1',
          fullName: 'Luis Gil',
          kind: 'club',
          staffRole: 'director',
          teamId: null,
          teamName: null,
          conversationId: null,
        },
      ],
    });
    expect(calls).toEqual([
      { fn: 'family_conversation_recipients', args: { p_player_id: PLAYER } },
    ]);
  });

  it('conversationId null es "todavia no hay hilo", no un fallo', async () => {
    const { sb } = makeClient({
      family_conversation_recipients: { data: [FILA_CLUB], error: null },
    });
    const r = await getFamilyRecipientsFromClient(sb, PLAYER);
    expect(r.ok && r.recipients[0]?.conversationId).toBeNull();
  });

  it('sin destinatarios es ok con la lista vacia, no un error', async () => {
    const { sb } = makeClient({ family_conversation_recipients: { data: [], error: null } });
    expect(await getFamilyRecipientsFromClient(sb, PLAYER)).toEqual({ ok: true, recipients: [] });
  });

  it('forbidden, no_session y error se distinguen entre si', async () => {
    for (const [message, reason] of [
      ['forbidden', 'forbidden'],
      ['no_session', 'no_session'],
      ['boom', 'error'],
    ] as const) {
      const { sb } = makeClient({
        family_conversation_recipients: { data: null, error: { message } },
      });
      expect(await getFamilyRecipientsFromClient(sb, PLAYER)).toEqual({ ok: false, reason });
    }
  });

  it('un kind que no sea club cae a team, sin inventarse un tercero', async () => {
    const { sb } = makeClient({
      family_conversation_recipients: { data: [{ ...FILA_EQUIPO, kind: 'raro' }], error: null },
    });
    const r = await getFamilyRecipientsFromClient(sb, PLAYER);
    expect(r.ok && r.recipients[0]?.kind).toBe('team');
  });

  it('los campos nulos llegan como null, no se inventan', async () => {
    const { sb } = makeClient({
      family_conversation_recipients: {
        data: [{ ...FILA_EQUIPO, full_name: null, team_id: null, team_name: null }],
        error: null,
      },
    });
    const r = await getFamilyRecipientsFromClient(sb, PLAYER);
    expect(r.ok && r.recipients[0]).toMatchObject({
      fullName: null,
      teamId: null,
      teamName: null,
    });
  });
});

describe('startFamilyConversationFromClient', () => {
  it('devuelve el id del hilo y pasa los dos argumentos', async () => {
    const { sb, calls } = makeClient({
      family_start_conversation: { data: 'conv-9', error: null },
    });

    const r = await startFamilyConversationFromClient(sb, PLAYER, 'mister-1');

    expect(r).toEqual({ ok: true, conversationId: 'conv-9' });
    expect(calls[0]?.args).toEqual({
      p_player_id: PLAYER,
      p_recipient_profile_id: 'mister-1',
    });
  });

  it('un destinatario no permitido es forbidden, no un hilo vacio', async () => {
    const { sb } = makeClient({
      family_start_conversation: { data: null, error: { message: 'forbidden' } },
    });
    expect(await startFamilyConversationFromClient(sb, PLAYER, 'ajeno')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('sin sesion es no_session', async () => {
    const { sb } = makeClient({
      family_start_conversation: { data: null, error: { message: 'no_session' } },
    });
    expect(await startFamilyConversationFromClient(sb, PLAYER, 'mister-1')).toEqual({
      ok: false,
      reason: 'no_session',
    });
  });

  it('sin error pero sin id es error: no se devuelve un hilo que no existe', async () => {
    const { sb } = makeClient({ family_start_conversation: { data: null, error: null } });
    expect(await startFamilyConversationFromClient(sb, PLAYER, 'mister-1')).toEqual({
      ok: false,
      reason: 'error',
    });
  });
});
