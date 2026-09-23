import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  getAccountDeletionHoldsFromClient,
  requestAccountDeletionFromClient,
} from '../index';

/**
 * RC-5 — los hijos que impiden que el tutor borre su cuenta.
 *
 * LO QUE CAMBIÓ RESPECTO A RC-3, y por qué este fichero se reescribió: la primera
 * versión recorría los jugadores del preview preguntando el estado de cada uno, y se
 * le escapaba un caso — `preview_account_deletion` no filtra por relación, así que un
 * jugador ADULTO con su propia cuenta y sin tutores sale en su PROPIO preview con
 * estado 'linked'. El bucle lo contaba como retención, y esa persona no podía borrar
 * nunca su cuenta: justo lo que el 5.1.1(v) de Apple prohíbe.
 *
 * El arreglo no fue añadir un filtro aquí —habría sido la tercera copia del mismo
 * predicado— sino llamar a `account_deletion_holds()`, que es LA MISMA función sobre
 * la que se levanta el rechazo de `request_account_deletion`. Por eso este fichero ya
 * no prueba ningún predicado: el predicado vive en SQL y lo mide
 * `supabase/tests/borrado_bloqueado_por_hijo.sql`, contra una base de datos de verdad.
 * Lo que queda aquí es el CONTRATO de la lectura, que es lo que decide qué pantalla ve
 * el usuario: qué llega cuando la RPC contesta bien, cuando falla y cuando contesta
 * algo que no reconocemos.
 */
type Llamada = { name: string; args: unknown };

function mockClient(
  respuesta: { data?: unknown; error?: { message: string } | null },
  llamadas: Llamada[] = [],
): SupabaseClient<Database> {
  return {
    rpc: async (name: string, args: unknown) => {
      llamadas.push({ name, args });
      return { data: respuesta.data ?? null, error: respuesta.error ?? null };
    },
  } as unknown as SupabaseClient<Database>;
}

function fila(over: Record<string, unknown> = {}) {
  return {
    hold_player_id: 'p1',
    first_name: 'Ana',
    last_name: 'Pérez',
    club_id: 'c1',
    club_name: 'Club',
    estado: 'linked',
    ...over,
  };
}

describe('la lectura de las retenciones', () => {
  it('devuelve lo que dice el SQL, con el nombre formateado como el preview', async () => {
    // «Apellido, Nombre», que es lo que hace `formatPlayerName` y lo que ya sale en la
    // lista de arriba del mismo diálogo. Dos formatos en la misma tarjeta se leen como
    // dos listas distintas.
    const sb = mockClient({ data: [fila(), fila({ hold_player_id: 'p3', first_name: 'Bru', estado: 'invited' })] });
    await expect(getAccountDeletionHoldsFromClient(sb)).resolves.toEqual({
      ok: true,
      holds: [
        { playerId: 'p1', playerName: 'Pérez, Ana', clubId: 'c1', clubName: 'Club', estado: 'linked' },
        { playerId: 'p3', playerName: 'Pérez, Bru', clubId: 'c1', clubName: 'Club', estado: 'invited' },
      ],
    });
  });

  it('pregunta a account_deletion_holds, y a nada más', async () => {
    // EL ARREGLO, en una linea: un solo predicado, el mismo que levanta el rechazo de
    // la RPC. Antes esto eran N llamadas y una copia del predicado en el cliente, y esa
    // copia se dejaba fuera al jugador adulto que se bloqueaba a si mismo.
    const llamadas: Llamada[] = [];
    const sb = mockClient({ data: [] }, llamadas);
    await getAccountDeletionHoldsFromClient(sb);
    expect(llamadas).toEqual([{ name: 'account_deletion_holds', args: undefined }]);
  });

  it('sin retenciones, la lista va vacía y eso SÍ se puede afirmar', async () => {
    const sb = mockClient({ data: [] });
    await expect(getAccountDeletionHoldsFromClient(sb)).resolves.toEqual({
      ok: true,
      holds: [],
    });
  });

  it('sin filas tampoco revienta', async () => {
    const sb = mockClient({ data: null });
    await expect(getAccountDeletionHoldsFromClient(sb)).resolves.toEqual({
      ok: true,
      holds: [],
    });
  });

  it('una lectura que falla NO se devuelve como «no hay nada»', async () => {
    // El corazón de este fichero. Devolver [] aquí le diría a quien va a dejar a un
    // menor sin tutor que nada se lo impide. No es enseñar menos datos: es otra cosa.
    const sb = mockClient({ error: { message: 'network' } });
    const res = await getAccountDeletionHoldsFromClient(sb);
    expect(res.ok).toBe(false);
  });

  it('un estado que no reconocemos tumba la lectura, no se descarta la fila', async () => {
    // Esa fila ES una retencion. Quedarse con las que se entienden daria una lista mas
    // corta de la real, que es la unica forma de equivocarse que importa aqui.
    const sb = mockClient({ data: [fila(), fila({ hold_player_id: 'p9', estado: 'lo_que_sea' })] });
    const res = await getAccountDeletionHoldsFromClient(sb);
    expect(res.ok).toBe(false);
    expect(String((res as { raw?: unknown }).raw)).toContain('lo_que_sea');
  });
});

describe('el rechazo de la RPC llega con nombre propio', () => {
  function mockRpc(error: { message: string }): SupabaseClient<Database> {
    return {
      rpc: async () => ({ data: null, error }),
    } as unknown as SupabaseClient<Database>;
  }

  it('«hijo_con_cuenta_propia» no cae en genérico', async () => {
    // Hace falta aunque la pantalla ya avise: entre que se pinta y se confirma, el
    // estado puede quedar rancio (el otro tutor invitando al crio a la vez).
    const res = await requestAccountDeletionFromClient(
      mockRpc({ message: 'hijo_con_cuenta_propia' }),
      null,
    );
    expect(res).toMatchObject({ ok: false, error: 'hijo_con_cuenta_propia' });
  });

  it('los demás códigos siguen donde estaban', async () => {
    const casos: [string, string][] = [
      ['admin_slot_taken', 'admin_slot_taken'],
      ['not_pending', 'not_pending'],
      ['no_session', 'no_session'],
      ['otra cosa', 'generic'],
    ];
    for (const [mensaje, esperado] of casos) {
      const res = await requestAccountDeletionFromClient(mockRpc({ message: mensaje }), null);
      expect(res).toMatchObject({ ok: false, error: esperado });
    }
  });
});
