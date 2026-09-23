import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import type { SelfInviteError } from '../self-invite';
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

  it('los bloqueos reutilizan el texto del error de la RPC', () => {
    // Misma frase en la tarjeta que despues de pulsar: dos textos para el mismo
    // hecho acaban divergiendo igual que divergen dos predicados.
    expect(selfAccountStatusMessageKey('erased')).toBe('errors.erased');
    expect(selfAccountStatusMessageKey('no_active_season')).toBe('errors.no_active_season');
    expect(selfAccountStatusMessageKey('consents_required')).toBe(
      'errors.consents_required',
    );
    expect(selfAccountStatusMessageKey('account_deletion_pending')).toBe(
      'errors.account_deletion_pending',
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

/**
 * RC-A — la clave que devuelve `selfAccountStatusMessageKey` TIENE QUE EXISTIR en los
 * tres catalogos.
 *
 * Por que esto es un test y no una suposicion: una clave que falta no rompe nada
 * ruidoso. No da error de tipos —los mensajes de next-intl no estan tipados—, no da
 * error de lint, y el guard de censo del repo busca lo CONTRARIO (cadenas que nadie
 * usa), asi que una clave usada y ausente se le escapa. Lo que se ve en pantalla es la
 * clave cruda o un hueco, y solo en el estado raro que casi nadie reproduce.
 *
 * Es justo el riesgo que corria este PR: la migracion 20261103000000 empezo a devolver
 * 'account_deletion_pending' ANTES de que el cliente supiera nada, y el unico motivo de
 * que aquello no dejara un boton muerto es que `getSelfAccountStatusFromClient`
 * devuelve `null` ante un valor desconocido. Aqui ya no hay esa red: si el estado esta
 * en la lista, su texto tiene que estar escrito.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const LOCALES = ['es', 'en', 'va'] as const;

function textoDe(loc: string, clave: string): unknown {
  const cat = JSON.parse(
    readFileSync(join(RAIZ, 'messages', `${loc}.json`), 'utf8'),
  ) as Record<string, unknown>;
  return `invite_self.${clave}`
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      cat,
    );
}

describe('los textos del bloque invite_self existen en los tres idiomas', () => {
  for (const loc of LOCALES) {
    it(`${loc}: ningun estado se queda sin frase`, () => {
      for (const estado of [
        'invited',
        'linked',
        ...SELF_ACCOUNT_BLOCKERS,
      ] as SelfAccountStatus[]) {
        const clave = selfAccountStatusMessageKey(estado);
        expect(clave, `${estado} no tiene clave`).toBeTruthy();
        const texto = textoDe(loc, clave as string);
        expect(typeof texto, `falta invite_self.${clave} en ${loc}.json`).toBe('string');
        expect((texto as string).trim().length, `invite_self.${clave} vacia en ${loc}`)
          .toBeGreaterThan(0);
      }
    });
  }

  /**
   * Y lo mismo para los ERRORES de la RPC. El diálogo de la web pinta
   * `t(`errors.${state.error}`)` SIN lista de conocidos delante, asi que una clave que
   * falte no degrada a un texto generico: se ve la clave cruda.
   *
   * `TODOS_LOS_ERRORES` no puede derivarse de un tipo —hace falta una lista en tiempo
   * de ejecucion—, asi que se escribe a mano y se ata por los dos lados: `satisfies`
   * impide meter uno que no exista, y `Falta` no compila si core anade uno y aqui no
   * se lista. Una lista escrita dos veces sin esa atadura es lo que dejo corta la
   * union de `InviteSelfState` en la web.
   */
  const TODOS_LOS_ERRORES = [
    'forbidden',
    'erased',
    'already_linked',
    'email_relation_conflict',
    'consents_required',
    'no_active_season',
    'account_deletion_pending',
    'email_invalid',
    'generic',
  ] as const satisfies readonly SelfInviteError[];

  type Falta = Exclude<SelfInviteError, (typeof TODOS_LOS_ERRORES)[number]>;
  const _sinOlvidos: Falta extends never ? true : false = true;

  for (const loc of LOCALES) {
    it(`${loc}: ningun error de la RPC se queda sin frase`, () => {
      expect(_sinOlvidos).toBe(true);
      // `email_too_long` no es un gate de la RPC: lo pone el esquema del formulario
      // antes de llamarla, y se pinta por el mismo sitio.
      for (const err of [...TODOS_LOS_ERRORES, 'email_too_long']) {
        const texto = textoDe(loc, `errors.${err}`);
        expect(typeof texto, `falta invite_self.errors.${err} en ${loc}.json`).toBe(
          'string',
        );
      }
    });
  }

  it('CONTROL POSITIVO: el lector encuentra de verdad los textos', () => {
    // Sin esto, un lector roto que devolviera undefined para todo haria pasar el
    // bloque de arriba en cuanto alguien cambiara un `toBe` por un `toBeDefined`, y
    // un fallo de ruta (la raiz del repo se calcula a mano) se leeria como catalogo
    // en regla.
    expect(textoDe('es', 'errors.consents_required')).toBe(
      'Antes hay que responder las autorizaciones de imagen del jugador para esta temporada.',
    );
    expect(textoDe('es', 'errors.no_existe_esta_clave')).toBeUndefined();
  });
});
