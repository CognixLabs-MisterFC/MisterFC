import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { SelfAccountStatus } from '../invitations/self-status';
import type { AccountDeletionBlocker } from './reads';

type DbClient = SupabaseClient<Database>;

/**
 * RC-3 — los hijos que IMPIDEN que el tutor borre su cuenta.
 *
 * LA REGLA (Jose): el tutor no puede borrar su cuenta mientras su hijo tenga cuenta
 * propia. Primero la retira —lo que puede hacer él solo desde el #698— y entonces
 * puede irse. Es la hermana de la que ya existe: un tutor no se borra si deja a un
 * menor sin tutor.
 *
 * ── POR QUÉ ESTE AVISO LLEGA ANTES QUE LA REGLA ─────────────────────────────
 * El candado lo pone la migración del PR-4, en `request_account_deletion`. Esto se
 * despliega ANTES a propósito: cuando esa migración se aplique, nadie se encuentra un
 * «ha ocurrido un error» sin explicación. Hasta entonces el aviso ya es verdad —el
 * borrado dejaría al menor sin tutor, medido en producción— y lo que hace es evitarlo
 * antes de pulsar en vez de después.
 *
 * ── DE DÓNDE SALE LA LISTA ──────────────────────────────────────────────────
 * De `preview_account_deletion`, que devuelve exactamente los jugadores activos de
 * los que el usuario es el ÚNICO tutor (desde MN-BC, «otro TUTOR» y no «otra cuenta»:
 * la fila `self` del hijo no vale como relevo). Es justo la población de la regla —si
 * queda otro tutor, el menor no se queda solo— así que no se recalcula aparte.
 *
 * ⚠️ EL PR-4 TIENE QUE USAR ESTA MISMA POBLACIÓN. Si el SQL mirase un conjunto más
 * ancho (por ejemplo, incluyendo jugadores que ya dejaron el club, que `preview`
 * filtra), el tutor se encontraría un rechazo que esta pantalla no le anunció. Es el
 * defecto que MN-BC y BC-3 llevan dos series cerrando: la pantalla y la acción
 * diciendo cosas distintas.
 *
 * ── UNA LECTURA MUDA AQUÍ ENSEÑA LA PANTALLA EQUIVOCADA ─────────────────────
 * Mismo criterio que el resto de `account-deletion`: si no se pudo saber, se propaga
 * el error y NO se devuelve una lista vacía. Una lista vacía significa «nada te
 * impide irte», y decirle eso a quien va a dejar a un menor de once años sin tutor no
 * es enseñar menos datos: es enseñar otra cosa.
 *
 * Por eso tampoco se reutiliza `getSelfAccountStatusFromClient`: allí `null` significa
 * a la vez «falló la lectura» y «contestó algo que no reconozco», y aquí esa
 * diferencia es la que decide si se puede afirmar que no hay nada que impida el
 * borrado. Se llama a la RPC directamente y cualquiera de los dos casos tumba la
 * lectura entera.
 */

/** Un hijo que impide el borrado, con el motivo: ya entra, o está a punto. */
export type AccountDeletionHold = AccountDeletionBlocker & {
  /** 'linked' = ya tiene su cuenta · 'invited' = hay una invitación viva sin usar. */
  estado: 'linked' | 'invited';
};

export type AccountDeletionHoldsResult =
  | { ok: true; holds: AccountDeletionHold[] }
  | { ok: false; raw: unknown };

/**
 * Los DOS estados de MN-9 que dan acceso. La invitación viva cuenta: si no, el tutor
 * se borra hoy y el crío entra mañana con el enlace, que es la misma puerta por la que
 * ya se coló esta regla una vez (ver la migración 20261100000000).
 */
export function holdsDeletion(estado: SelfAccountStatus | null): boolean {
  return estado === 'linked' || estado === 'invited';
}

export async function getAccountDeletionHoldsFromClient(
  supabase: DbClient,
  blockers: readonly AccountDeletionBlocker[],
): Promise<AccountDeletionHoldsResult> {
  const holds: AccountDeletionHold[] = [];

  for (const b of blockers) {
    const { data, error } = await supabase.rpc('player_self_account_status', {
      p_player_id: b.playerId,
    });
    if (error) return { ok: false, raw: error };
    if (typeof data !== 'string') {
      return {
        ok: false,
        raw: new Error(`player_self_account_status devolvio ${JSON.stringify(data)}`),
      };
    }
    if (holdsDeletion(data as SelfAccountStatus)) {
      holds.push({ ...b, estado: data as 'linked' | 'invited' });
    }
  }

  return { ok: true, holds };
}
