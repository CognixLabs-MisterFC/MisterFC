import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { formatPlayerName } from '../utils/name';

type DbClient = SupabaseClient<Database>;

/**
 * RC-5 — los hijos que IMPIDEN que el tutor borre su cuenta.
 *
 * LA REGLA (Jose): el tutor no puede borrar su cuenta mientras su hijo tenga cuenta
 * propia. Primero la retira —lo que puede hacer él solo— y entonces puede irse.
 *
 * ── ESTO ERA UN BUCLE EN EL CLIENTE, Y TENÍA UN FALLO ───────────────────────
 * La primera versión (RC-3) recorría los jugadores de `preview_account_deletion` y
 * preguntaba el estado de cada uno. Funcionaba, pero se le escapaba un caso que la
 * migración 20261101000000 midió después:
 *
 *   `preview_account_deletion` NO filtra por relación, así que un jugador ADULTO con
 *   su propia cuenta y sin tutores sale en su PROPIO preview, con estado 'linked'.
 *   El bucle lo contaba como retención → esa persona no podía borrar NUNCA su cuenta.
 *   Eso es exactamente lo que el 5.1.1(v) de Apple prohíbe.
 *
 * Medido en producción con ROLLBACK (jugador nacido en 1995, solo fila `self`):
 * sale en su preview y responde 'linked'. No era alcanzable con los datos de entonces
 * —0 filas `self` de adultos— pero la migración 20261038 existe para permitirlo.
 *
 * ── EL ARREGLO NO ES AÑADIR UN FILTRO AQUÍ ──────────────────────────────────
 * Sería la tercera copia del mismo predicado. Se llama a `account_deletion_holds()`,
 * que es LA MISMA función sobre la que se levanta el `raise` de
 * `request_account_deletion`. Un solo predicado, en SQL, para la pantalla y para la
 * regla: no pueden discrepar ni hoy ni cuando alguien cambie uno de los dos. Es la
 * lección de MN-BC y de BC-3, que costó una serie cada una.
 *
 * De paso desaparece el N+1 de llamadas y la dependencia de que el caller le pase la
 * lista correcta: la función se basta sola.
 *
 * ── UNA LECTURA MUDA AQUÍ ENSEÑA LA PANTALLA EQUIVOCADA ─────────────────────
 * Mismo criterio que el resto de `account-deletion`: si no se pudo saber, se propaga
 * el error y NO se devuelve una lista vacía. Una lista vacía significa «nada te
 * impide irte», y decirle eso a quien va a dejar a un menor sin tutor no es enseñar
 * menos datos: es enseñar otra cosa.
 */

/** Un hijo que impide el borrado, con el motivo: ya entra, o está a punto. */
export type AccountDeletionHold = {
  playerId: string;
  /** Ya formateado con `formatPlayerName`, igual que `AccountDeletionBlocker`. */
  playerName: string;
  clubId: string;
  clubName: string;
  /** 'linked' = ya tiene su cuenta · 'invited' = hay una invitación viva sin usar. */
  estado: 'linked' | 'invited';
};

export type AccountDeletionHoldsResult =
  | { ok: true; holds: AccountDeletionHold[] }
  | { ok: false; raw: unknown };

/**
 * `account_deletion_holds()` — sin efectos, `auth.uid()` cableado en el SQL: no hay
 * parámetro de target, así que no puede devolver las retenciones de otra persona.
 *
 * Un `estado` que no reconocemos tumba la lectura entera en vez de descartarse: esa
 * fila ES una retención, y quedarnos con las que entendemos daría una lista más corta
 * de la real — que es la única forma de equivocarse que importa aquí.
 */
export async function getAccountDeletionHoldsFromClient(
  supabase: DbClient,
): Promise<AccountDeletionHoldsResult> {
  const { data, error } = await supabase.rpc('account_deletion_holds');
  if (error) return { ok: false, raw: error };

  const rows = data ?? [];
  const holds: AccountDeletionHold[] = [];
  for (const r of rows) {
    if (r.estado !== 'linked' && r.estado !== 'invited') {
      return {
        ok: false,
        raw: new Error(`account_deletion_holds devolvio estado ${JSON.stringify(r.estado)}`),
      };
    }
    holds.push({
      playerId: r.hold_player_id,
      playerName: formatPlayerName(r.first_name, r.last_name),
      clubId: r.club_id,
      clubName: r.club_name,
      estado: r.estado,
    });
  }
  return { ok: true, holds };
}
