import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlayerContactFromClient } from '../reads';
import type { Database } from '../../supabase/types';

/**
 * Lo que se protege aquí es la distinción que la pantalla NO puede inventarse:
 *
 *   · «este niño no tiene teléfono» → un hueco, y está bien,
 *   · «no tengo permiso»            → el bloque no se pinta,
 *   · «se ha roto algo»             → hay que DECIRLO.
 *
 * Si las tres colapsan en un array vacío, un fallo de lectura se disfraza de
 * ficha sin datos y nadie se entera hasta que un entrenador necesita llamar.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

/** Mock de las dos RPC. Registra los argumentos para poder aseverarlos. */
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

const TUTOR_ROW = {
  tutor_profile_id: 'tutor-1',
  full_name: 'Ana Pérez',
  relation: 'parent',
  email: 'ana@example.com',
  phone: '600 123 456',
};

describe('getPlayerContactFromClient', () => {
  it('con acceso devuelve el teléfono del jugador y el contacto de cada tutor', async () => {
    const { sb, calls } = makeClient({
      get_player_phone: { data: '600 111 222', error: null },
      get_player_tutors_contact: { data: [TUTOR_ROW], error: null },
    });

    const r = await getPlayerContactFromClient(sb, PLAYER);

    expect(r).toEqual({
      ok: true,
      playerPhone: '600 111 222',
      tutors: [
        {
          tutorProfileId: 'tutor-1',
          fullName: 'Ana Pérez',
          relation: 'parent',
          email: 'ana@example.com',
          phone: '600 123 456',
        },
      ],
    });
    // Las dos RPC, con el jugador correcto.
    expect(calls.map((c) => c.fn).sort()).toEqual([
      'get_player_phone',
      'get_player_tutors_contact',
    ]);
    for (const c of calls) expect(c.args.p_player_id).toBe(PLAYER);
  });

  it('sin teléfono NO es un fallo: ok con null', async () => {
    const { sb } = makeClient({
      get_player_phone: { data: null, error: null },
      get_player_tutors_contact: { data: [], error: null },
    });
    expect(await getPlayerContactFromClient(sb, PLAYER)).toEqual({
      ok: true,
      playerPhone: null,
      tutors: [],
    });
  });

  it('sin permiso → forbidden, para que la pantalla no pinte el bloque', async () => {
    const { sb } = makeClient({
      get_player_phone: { data: null, error: { message: 'forbidden' } },
      get_player_tutors_contact: { data: null, error: { message: 'forbidden' } },
    });
    expect(await getPlayerContactFromClient(sb, PLAYER)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('un fallo cualquiera → error, y NO se disfraza de "sin datos"', async () => {
    const { sb } = makeClient({
      get_player_phone: { data: null, error: { message: 'network is unreachable' } },
      get_player_tutors_contact: { data: [], error: null },
    });
    expect(await getPlayerContactFromClient(sb, PLAYER)).toEqual({ ok: false, reason: 'error' });
  });

  it('si falla SOLO la lista de tutores, tampoco se devuelve media verdad', async () => {
    const { sb } = makeClient({
      get_player_phone: { data: '600 111 222', error: null },
      get_player_tutors_contact: { data: null, error: { message: 'boom' } },
    });
    expect(await getPlayerContactFromClient(sb, PLAYER)).toEqual({ ok: false, reason: 'error' });
  });

  it('la auditoría viaja a las dos RPC, y sin datos queda en undefined', async () => {
    const conAudit = makeClient({
      get_player_phone: { data: null, error: null },
      get_player_tutors_contact: { data: [], error: null },
    });
    await getPlayerContactFromClient(conAudit.sb, PLAYER, { ip: '1.2.3.4', userAgent: 'Firefox' });
    for (const c of conAudit.calls) {
      expect(c.args.p_ip).toBe('1.2.3.4');
      expect(c.args.p_user_agent).toBe('Firefox');
    }

    const sinAudit = makeClient({
      get_player_phone: { data: null, error: null },
      get_player_tutors_contact: { data: [], error: null },
    });
    await getPlayerContactFromClient(sinAudit.sb, PLAYER);
    for (const c of sinAudit.calls) {
      expect(c.args.p_ip).toBeUndefined();
      expect(c.args.p_user_agent).toBeUndefined();
    }
  });
});
