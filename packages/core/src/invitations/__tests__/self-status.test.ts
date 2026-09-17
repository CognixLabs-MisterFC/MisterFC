import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  getSelfAccountStatusFromClient,
  isSelfAccountBlocker,
  selfAccountStatusMessageKey,
  SELF_ACCOUNT_BLOCKERS,
  type SelfAccountStatus,
} from '../self-status';

/**
 * MN-9 — el estado de la cuenta propia del jugador.
 *
 * Lo que se prueba aquí no es el SQL (eso lo mide la suite pgTAP contra una BD de
 * verdad), sino el CONTRATO de la lectura: qué llega a la pantalla cuando la RPC
 * contesta bien, cuando falla y cuando contesta algo que no reconocemos. Los tres
 * llevan a decisiones distintas de la tarjeta.
 *
 * El error se devuelve como `{ error }`, NO lanzándolo: postgrest-js no rechaza
 * nunca la promesa, y un mock que lanza probaría un camino que en producción no
 * existe.
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

describe('getSelfAccountStatusFromClient', () => {
  it('devuelve los tres estados tal cual los da la RPC', async () => {
    for (const estado of ['none', 'invited', 'linked'] as const) {
      const sb = mockClient({ data: estado });
      await expect(getSelfAccountStatusFromClient(sb, 'p1')).resolves.toBe(estado);
    }
  });

  it('llama a player_self_account_status con el jugador', async () => {
    const llamadas: Llamada[] = [];
    const sb = mockClient({ data: 'none' }, llamadas);
    await getSelfAccountStatusFromClient(sb, 'jugador-1');
    expect(llamadas).toEqual([
      { name: 'player_self_account_status', args: { p_player_id: 'jugador-1' } },
    ]);
  });

  it('null si la RPC devuelve error (forbidden, red caída…)', async () => {
    const sb = mockClient({ error: { message: 'forbidden' } });
    await expect(getSelfAccountStatusFromClient(sb, 'p1')).resolves.toBeNull();
  });

  it('null si contesta algo que no reconocemos: no se inventa un estado', async () => {
    for (const raro of ['pending', '', 'LINKED', null, 42, { estado: 'none' }]) {
      const sb = mockClient({ data: raro });
      await expect(getSelfAccountStatusFromClient(sb, 'p1')).resolves.toBeNull();
    }
  });

  it('un error NO se confunde con un estado aunque venga data', async () => {
    // Si algún día la RPC devolviera las dos cosas, manda el error.
    const sb = mockClient({ data: 'none', error: { message: 'forbidden' } });
    await expect(getSelfAccountStatusFromClient(sb, 'p1')).resolves.toBeNull();
  });
});

describe('selfAccountStatusMessageKey', () => {
  it('none no dice nada: es el unico que enseña el boton', () => {
    expect(selfAccountStatusMessageKey('none')).toBeNull();
  });

  it('los dos estados de cuenta usan state.*', () => {
    expect(selfAccountStatusMessageKey('invited')).toBe('state.invited');
    expect(selfAccountStatusMessageKey('linked')).toBe('state.linked');
  });

  it('los tres bloqueos reutilizan el texto del error de la RPC', () => {
    // Misma frase en la tarjeta que despues de pulsar: dos textos para el mismo
    // hecho acaban divergiendo igual que divergen dos predicados.
    expect(selfAccountStatusMessageKey('erased')).toBe('errors.erased');
    expect(selfAccountStatusMessageKey('no_active_season')).toBe('errors.no_active_season');
    expect(selfAccountStatusMessageKey('consents_required')).toBe(
      'errors.consents_required',
    );
  });

  it('todo estado distinto de none tiene texto: ninguno se queda mudo', () => {
    for (const estado of [
      'invited',
      'linked',
      ...SELF_ACCOUNT_BLOCKERS,
    ] as SelfAccountStatus[]) {
      expect(selfAccountStatusMessageKey(estado)).toBeTruthy();
    }
  });

  it('isSelfAccountBlocker separa los motivos de los estados de cuenta', () => {
    expect(SELF_ACCOUNT_BLOCKERS.every(isSelfAccountBlocker)).toBe(true);
    for (const estado of ['none', 'invited', 'linked'] as SelfAccountStatus[]) {
      expect(isSelfAccountBlocker(estado)).toBe(false);
    }
  });
});
