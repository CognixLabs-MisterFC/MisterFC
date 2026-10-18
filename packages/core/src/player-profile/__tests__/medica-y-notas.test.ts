import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { getPlayerMedicalFromClient, readPlayerMedicalFromClient } from '../sensitive';
import { getPlayerNotesFromClient } from '../notes';

/**
 * Las dos superficies RESERVADAS de la ficha de un jugador —la médica y las notas
 * del cuerpo técnico— y la única pregunta que las dos tienen que saber responder:
 *
 *   · «no hay nada apuntado»  → un hueco, y está bien,
 *   · «no tienes acceso»      → el bloque no se pinta,
 *   · «se ha roto algo»       → hay que DECIRLO.
 *
 * Si las tres colapsan en un vacío, un entrenador que no tiene permiso —o una
 * consulta rota— leen «sin alergias» en la ficha de un crío alérgico. Esto es lo
 * que impide que eso se escriba sin que nada se ponga rojo.
 */

type RpcResult = { data: unknown; error: { message: string } | null };
type SelectResult = { data: unknown; error: { message: string } | null };

/** Mock de las RPC + la consulta a `player_notes`. Registra lo que se pidió. */
function makeClient(cfg: { rpc?: Record<string, RpcResult>; notes?: SelectResult }) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const query: Record<string, unknown> = {};
  const sb = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(cfg.rpc?.[fn] ?? { data: null, error: { message: 'sin mock' } });
    },
    from: (table: string) => {
      query.table = table;
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        query.select = cols;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        query.eqCol = col;
        query.eqVal = val;
        return chain;
      };
      chain.order = (col: string, opts: { ascending: boolean }) => {
        query.orderCol = col;
        query.ascending = opts.ascending;
        return Promise.resolve(cfg.notes ?? { data: [], error: null });
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, rpcCalls, query };
}

const PLAYER = 'player-1';
const FILA_MEDICA = {
  allergies: 'polen',
  medication: null,
  medical_conditions: null,
  emergency_contact: '600 111 222',
};

describe('la médica distingue los tres estados', () => {
  // ANCLA POSITIVA, primero: si el mock no respondiera por el nombre bueno, los
  // casos de abajo saldrían «bien» por el motivo equivocado.
  it('con acceso y con datos devuelve la fila', async () => {
    const { sb, rpcCalls } = makeClient({
      rpc: { get_player_medical: { data: [FILA_MEDICA], error: null } },
    });

    expect(await readPlayerMedicalFromClient(sb, PLAYER)).toEqual({
      ok: true,
      medical: {
        allergies: 'polen',
        medication: null,
        medical_conditions: null,
        emergency_contact: '600 111 222',
      },
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fn).toBe('get_player_medical');
    expect(rpcCalls[0]?.args.p_player_id).toBe(PLAYER);
  });

  it('con acceso y SIN datos: ok, y la médica es null', async () => {
    const { sb } = makeClient({ rpc: { get_player_medical: { data: [], error: null } } });
    expect(await readPlayerMedicalFromClient(sb, PLAYER)).toEqual({ ok: true, medical: null });
  });

  it('sin acceso (o sin consentimiento) la RPC lanza forbidden', async () => {
    const { sb } = makeClient({
      rpc: { get_player_medical: { data: null, error: { message: 'forbidden' } } },
    });
    expect(await readPlayerMedicalFromClient(sb, PLAYER)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('cualquier otro fallo es un ERROR, no un hueco ni un forbidden', async () => {
    const { sb } = makeClient({
      rpc: {
        get_player_medical: { data: null, error: { message: 'TypeError: Network request failed' } },
      },
    });
    expect(await readPlayerMedicalFromClient(sb, PLAYER)).toEqual({ ok: false, reason: 'error' });
  });

  // La lectura vieja la siguen usando las pantallas de GESTIÓN (familia y web), que
  // no se tocan en esta pieza: tiene que seguir aplanando exactamente igual.
  it('la lectura aplanada sigue dando la fila, o null en los dos «no»', async () => {
    const conDatos = makeClient({
      rpc: { get_player_medical: { data: [FILA_MEDICA], error: null } },
    });
    expect(await getPlayerMedicalFromClient(conDatos.sb, PLAYER)).toEqual(FILA_MEDICA);

    const vacia = makeClient({ rpc: { get_player_medical: { data: [], error: null } } });
    expect(await getPlayerMedicalFromClient(vacia.sb, PLAYER)).toBeNull();

    const prohibida = makeClient({
      rpc: { get_player_medical: { data: null, error: { message: 'forbidden' } } },
    });
    expect(await getPlayerMedicalFromClient(prohibida.sb, PLAYER)).toBeNull();
  });
});

describe('las notas distinguen «no hay» de «no puedes»', () => {
  const FILA_NOTA = {
    id: 'n1',
    note: 'Empieza a mirar antes de recibir.',
    created_at: '2026-10-01T10:00:00Z',
    profiles: { full_name: 'Marta Ruiz' },
  };

  it('con acceso devuelve las notas con su autor, de la más reciente a la más antigua', async () => {
    const { sb, rpcCalls, query } = makeClient({
      rpc: { user_can_access_player_notes: { data: true, error: null } },
      notes: { data: [FILA_NOTA], error: null },
    });

    expect(await getPlayerNotesFromClient(sb, PLAYER)).toEqual({
      ok: true,
      notes: [
        {
          id: 'n1',
          note: 'Empieza a mirar antes de recibir.',
          createdAt: '2026-10-01T10:00:00Z',
          authorName: 'Marta Ruiz',
        },
      ],
    });
    // Se preguntó por la puerta, y se leyó la tabla del jugador, ordenada.
    expect(rpcCalls.map((c) => c.fn)).toEqual(['user_can_access_player_notes']);
    expect(query.table).toBe('player_notes');
    expect(query.eqCol).toBe('player_id');
    expect(query.eqVal).toBe(PLAYER);
    expect(query.orderCol).toBe('created_at');
    expect(query.ascending).toBe(false);
  });

  // EL CASO QUE JUSTIFICA LA PUERTA APARTE. Quien no pasa la RLS recibe cero filas,
  // igual que un jugador sin notas: sin preguntar, las dos se pintarían «sin notas».
  it('sin acceso son CERO filas, y aun así el resultado dice forbidden', async () => {
    const { sb } = makeClient({
      rpc: { user_can_access_player_notes: { data: false, error: null } },
      notes: { data: [], error: null },
    });
    expect(await getPlayerNotesFromClient(sb, PLAYER)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('con acceso y sin notas: ok y lista vacía', async () => {
    const { sb } = makeClient({
      rpc: { user_can_access_player_notes: { data: true, error: null } },
      notes: { data: [], error: null },
    });
    expect(await getPlayerNotesFromClient(sb, PLAYER)).toEqual({ ok: true, notes: [] });
  });

  it('un fallo de la puerta o de la consulta es un ERROR', async () => {
    const puertaRota = makeClient({
      rpc: { user_can_access_player_notes: { data: null, error: { message: 'boom' } } },
      notes: { data: [], error: null },
    });
    expect(await getPlayerNotesFromClient(puertaRota.sb, PLAYER)).toEqual({
      ok: false,
      reason: 'error',
    });

    const consultaRota = makeClient({
      rpc: { user_can_access_player_notes: { data: true, error: null } },
      notes: { data: null, error: { message: 'boom' } },
    });
    expect(await getPlayerNotesFromClient(consultaRota.sb, PLAYER)).toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('una nota sin autor legible no rompe la lista', async () => {
    const { sb } = makeClient({
      rpc: { user_can_access_player_notes: { data: true, error: null } },
      notes: { data: [{ ...FILA_NOTA, profiles: null }], error: null },
    });
    const r = await getPlayerNotesFromClient(sb, PLAYER);
    expect(r.ok && r.notes[0]?.authorName).toBeNull();
  });
});
