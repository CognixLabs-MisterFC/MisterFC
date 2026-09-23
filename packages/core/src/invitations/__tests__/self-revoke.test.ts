import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  canOfferSelfRevoke,
  getSelfRevokeGateFromClient,
  mapSelfRevokeError,
  revokePlayerSelfAccountFromClient,
  selfRevokeDoneMessageKey,
  type SelfRevokeGate,
} from '../self-revoke';
import type { SelfAccountStatus } from '../self-status';

/**
 * RC-2 — el tutor retira la cuenta propia de su hijo.
 *
 * Lo que se prueba aquí no es el SQL —eso lo mide la suite pgTAP contra una BD de
 * verdad, en `supabase/tests/retirar_cuenta_propia.sql`— sino las dos decisiones que
 * vive el cliente: A QUIÉN se le ofrece el botón, y qué le llega cuando la RPC
 * contesta bien, falla o contesta algo que no reconocemos.
 *
 * El error se devuelve como `{ error }` y NO lanzándolo: postgrest-js no rechaza
 * nunca la promesa, y un mock que lanza probaría un camino que en produccion no
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

function mockGateClient(
  por: Record<string, unknown>,
  llamadas: Llamada[] = [],
): SupabaseClient<Database> {
  return {
    rpc: async (name: string, args: unknown) => {
      llamadas.push({ name, args });
      return { data: por[name] ?? null, error: null };
    },
  } as unknown as SupabaseClient<Database>;
}

const tutorDeUnMenor: SelfRevokeGate = { isTutor: true, isMinor: true };

describe('a quién se le ofrece retirar', () => {
  it('al tutor de un menor, cuando el hijo tiene cuenta o invitación viva', () => {
    for (const status of ['linked', 'invited'] as const) {
      expect(canOfferSelfRevoke({ status, gate: tutorDeUnMenor })).toBe(true);
    }
  });

  it('AL PROPIO JUGADOR NO, aunque el estado le diga linked', () => {
    // MN-9 gatea el estado con `user_manages_player`, así que al chaval con cuenta
    // propia le contesta 'linked' igual que a su padre. Si el botón colgara solo del
    // estado, se encontraría un «retirar mi cuenta» que el SQL le va a negar.
    expect(
      canOfferSelfRevoke({ status: 'linked', gate: { isTutor: false, isMinor: true } }),
    ).toBe(false);
  });

  it('cumplidos los 18 tampoco, aunque quien mire sea su tutor', () => {
    expect(
      canOfferSelfRevoke({ status: 'linked', gate: { isTutor: true, isMinor: false } }),
    ).toBe(false);
  });

  it('no hay nada que retirar en los demás estados', () => {
    const otros: SelfAccountStatus[] = [
      'none',
      'erased',
      'no_active_season',
      'consents_required',
    ];
    for (const status of otros) {
      expect(canOfferSelfRevoke({ status, gate: tutorDeUnMenor })).toBe(false);
    }
  });

  it('si no se pudo leer el estado, no se ofrece', () => {
    expect(canOfferSelfRevoke({ status: null, gate: tutorDeUnMenor })).toBe(false);
  });

  it('si no se pudo leer el gate, tampoco: una lectura que falla no abre puertas', () => {
    expect(
      canOfferSelfRevoke({ status: 'linked', gate: { isTutor: false, isMinor: false } }),
    ).toBe(false);
  });
});

describe('el gate se pregunta con los MISMOS predicados que gatean la RPC', () => {
  it('pregunta por user_is_tutor_of_player y player_is_minor, y por nada más', async () => {
    // No se deriva de `canManageSensitive` aunque hoy diera lo mismo para un menor:
    // un equivalente no es el mismo predicado, y el día que uno cambie la tarjeta y
    // el botón dirían cosas distintas.
    const llamadas: Llamada[] = [];
    const sb = mockGateClient(
      { user_is_tutor_of_player: true, player_is_minor: true },
      llamadas,
    );
    await expect(getSelfRevokeGateFromClient(sb, 'p1')).resolves.toEqual({
      isTutor: true,
      isMinor: true,
    });
    expect(llamadas.map((l) => l.name).sort()).toEqual([
      'player_is_minor',
      'user_is_tutor_of_player',
    ]);
    expect(llamadas.every((l) => l.args && (l.args as { p_player_id: string }).p_player_id === 'p1')).toBe(true);
  });

  it('lo que no responde se toma como «no»', async () => {
    const sb = mockGateClient({});
    await expect(getSelfRevokeGateFromClient(sb, 'p1')).resolves.toEqual({
      isTutor: false,
      isMinor: false,
    });
  });
});

describe('la llamada a la RPC', () => {
  it('devuelve los tres resultados tal cual los da el SQL', async () => {
    for (const outcome of ['account', 'invitation', 'none'] as const) {
      const sb = mockClient({ data: outcome });
      await expect(revokePlayerSelfAccountFromClient(sb, 'p1')).resolves.toEqual({
        ok: outcome,
      });
    }
  });

  it('llama a revoke_player_self_account con el jugador, y a nada más', async () => {
    const llamadas: Llamada[] = [];
    const sb = mockClient({ data: 'account' }, llamadas);
    await revokePlayerSelfAccountFromClient(sb, 'p7');
    expect(llamadas).toEqual([
      { name: 'revoke_player_self_account', args: { p_player_id: 'p7' } },
    ]);
  });

  it('un valor que no reconocemos NO se hace pasar por «no había nada»', async () => {
    // Es la única respuesta que mentiría. Reintentar no cuesta: la RPC es idempotente.
    const sb = mockClient({ data: 'lo_que_sea' });
    const res = await revokePlayerSelfAccountFromClient(sb, 'p1');
    expect(res).toMatchObject({ error: 'generic' });
    // Y con el valor dentro, para que en Sentry se vea QUE devolvio, no solo que fallo.
    expect(String((res as { raw?: unknown }).raw)).toContain('lo_que_sea');
  });

  it('los gates llegan con su nombre', async () => {
    const casos: [string, string][] = [
      ['new row violates: jugador_mayor_de_edad', 'jugador_mayor_de_edad'],
      ['forbidden', 'forbidden'],
      ['cualquier otra cosa', 'generic'],
    ];
    for (const [mensaje, esperado] of casos) {
      const sb = mockClient({ error: { message: mensaje } });
      const res = await revokePlayerSelfAccountFromClient(sb, 'p1');
      expect(res).toMatchObject({ error: esperado });
      // El gate conocido NO se reporta: es una respuesta del negocio, no una averia.
      expect('raw' in res).toBe(esperado === 'generic');
    }
  });

  it('«no_session» cae en generic A PROPÓSITO', () => {
    // Si no hay sesión no se llega hasta aquí: la pantalla lo corta antes. Darle
    // nombre de gate haría pensar en un permiso donde solo hay una sesión caducada.
    expect(mapSelfRevokeError('no_session')).toBe('generic');
  });
});

describe('qué se le dice al tutor cuando termina', () => {
  it('los tres resultados llevan a tres frases distintas', () => {
    const claves = (['account', 'invitation', 'none'] as const).map(
      selfRevokeDoneMessageKey,
    );
    expect(new Set(claves).size).toBe(3);
    expect(claves).toEqual(['done.account', 'done.invitation', 'done.none']);
  });
});
