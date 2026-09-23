import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  getAccountDeletionHoldsFromClient,
  holdsDeletion,
  requestAccountDeletionFromClient,
  type AccountDeletionBlocker,
} from '../index';
import type { SelfAccountStatus } from '../../invitations/index';

/**
 * RC-3 — los hijos que impiden que el tutor borre su cuenta.
 *
 * Lo que se prueba aquí es la decisión que vive en el cliente: a quién se le dice que
 * NO puede irse todavía, y —sobre todo— qué pasa cuando no se ha podido saber. Esa
 * segunda parte es la que importa: una lista vacía significa «nada te impide irte», y
 * es la única respuesta que no se puede dar por descarte.
 */
type Llamada = { name: string; args: unknown };

function jugador(id: string, nombre: string): AccountDeletionBlocker {
  return { playerId: id, playerName: nombre, clubId: 'c1', clubName: 'Club' };
}

/** Responde el estado que le toca a cada jugador. */
function mockPorJugador(
  porJugador: Record<string, unknown>,
  llamadas: Llamada[] = [],
  error: { message: string } | null = null,
): SupabaseClient<Database> {
  return {
    rpc: async (name: string, args: unknown) => {
      llamadas.push({ name, args });
      if (error) return { data: null, error };
      const id = (args as { p_player_id: string }).p_player_id;
      return { data: porJugador[id] ?? null, error: null };
    },
  } as unknown as SupabaseClient<Database>;
}

describe('qué estados impiden el borrado', () => {
  it('los dos que dan acceso: la cuenta ya creada y la invitación viva', () => {
    expect(holdsDeletion('linked')).toBe(true);
    expect(holdsDeletion('invited')).toBe(true);
  });

  it('la invitación viva cuenta, y no es un detalle', () => {
    // Si no contara, el tutor se borra hoy y el crío entra mañana con el enlace. Es la
    // misma puerta por la que esta regla ya se coló una vez (mig 20261100000000).
    expect(holdsDeletion('invited')).toBe(true);
  });

  it('los demás no impiden nada', () => {
    const otros: (SelfAccountStatus | null)[] = [
      'none',
      'erased',
      'no_active_season',
      'consents_required',
      null,
    ];
    for (const e of otros) expect(holdsDeletion(e)).toBe(false);
  });
});

describe('la lectura de los bloqueos', () => {
  it('devuelve solo los que bloquean, con su motivo', async () => {
    const sb = mockPorJugador({ p1: 'linked', p2: 'none', p3: 'invited' });
    const res = await getAccountDeletionHoldsFromClient(sb, [
      jugador('p1', 'Ana'),
      jugador('p2', 'Bru'),
      jugador('p3', 'Cloe'),
    ]);
    expect(res).toEqual({
      ok: true,
      holds: [
        { ...jugador('p1', 'Ana'), estado: 'linked' },
        { ...jugador('p3', 'Cloe'), estado: 'invited' },
      ],
    });
  });

  it('sin bloqueantes, la lista va vacía y eso SÍ se puede afirmar', async () => {
    const sb = mockPorJugador({ p1: 'none' });
    await expect(
      getAccountDeletionHoldsFromClient(sb, [jugador('p1', 'Ana')]),
    ).resolves.toEqual({ ok: true, holds: [] });
  });

  it('una lectura que falla NO se devuelve como «no hay nada»', async () => {
    // Es el corazón de este fichero. Devolver [] aquí le diría a quien va a dejar a un
    // menor sin tutor que nada se lo impide. No es enseñar menos datos: es otra cosa.
    const sb = mockPorJugador({}, [], { message: 'network' });
    const res = await getAccountDeletionHoldsFromClient(sb, [jugador('p1', 'Ana')]);
    expect(res.ok).toBe(false);
  });

  it('un valor que no reconocemos tampoco', async () => {
    const sb = mockPorJugador({ p1: 42 });
    const res = await getAccountDeletionHoldsFromClient(sb, [jugador('p1', 'Ana')]);
    expect(res.ok).toBe(false);
    expect(String((res as { raw?: unknown }).raw)).toContain('42');
  });

  it('pregunta por el estado de CADA jugador de la lista, uno por uno', async () => {
    const llamadas: Llamada[] = [];
    const sb = mockPorJugador({ p1: 'none', p2: 'none' }, llamadas);
    await getAccountDeletionHoldsFromClient(sb, [jugador('p1', 'Ana'), jugador('p2', 'Bru')]);
    expect(llamadas).toEqual([
      { name: 'player_self_account_status', args: { p_player_id: 'p1' } },
      { name: 'player_self_account_status', args: { p_player_id: 'p2' } },
    ]);
  });

  it('con la lista vacía no pregunta nada', async () => {
    const llamadas: Llamada[] = [];
    const sb = mockPorJugador({}, llamadas);
    await expect(getAccountDeletionHoldsFromClient(sb, [])).resolves.toEqual({
      ok: true,
      holds: [],
    });
    expect(llamadas).toEqual([]);
  });
});

describe('el rechazo del PR-4 llega con nombre propio', () => {
  function mockRpc(error: { message: string }): SupabaseClient<Database> {
    return {
      rpc: async () => ({ data: null, error }),
    } as unknown as SupabaseClient<Database>;
  }

  it('«hijo_con_cuenta_propia» no cae en genérico', async () => {
    // Va desplegado ANTES que la migración que lo levanta: cuando se aplique, nadie se
    // encuentra un «no se pudo completar» sin explicación.
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
