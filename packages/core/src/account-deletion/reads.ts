/**
 * BC-2 — LECTURAS del borrado de cuenta (serie BC, ver `docs/specs/BC.0-borrado-de-cuenta.md`).
 *
 * Dos lecturas, ambas sobre RPC SECURITY DEFINER con `auth.uid()` CABLEADO en el SQL:
 * no hay parámetro de target, así que ninguna de las dos puede devolver el estado de
 * otra persona por más que se manipule la llamada.
 *
 * POR QUÉ AMBAS PROPAGAN EL ERROR en vez de devolver vacío (mismo criterio que
 * `getMyPhoneFromClient`, y a diferencia del resto de lecturas del paquete): aquí una
 * lectura muda no enseña "menos datos", enseña **la pantalla equivocada**.
 *  · si `preview` falla y devolvemos [], el usuario lee "no se pedirá la supresión de
 *    nadie" y confirma un borrado cuyo alcance real es otro;
 *  · si `status` falla y devolvemos null, alguien con la cuenta EN BORRADO ve la app
 *    normal en lugar de la pantalla terminal con su fecha límite y el botón de cancelar.
 * En los dos casos el caller tiene que poder distinguir "no hay" de "no se pudo leer".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { formatPlayerName } from '../utils/name';

type DbClient = SupabaseClient<Database>;

/**
 * Un jugador ACTIVO del que el usuario es el ÚNICO tutor. Al pedir el borrado, cada uno
 * de estos genera una solicitud de supresión que decide el club (decisión 1 de Jose:
 * nadie depende de un tercero para poder irse).
 */
export type AccountDeletionBlocker = {
  playerId: string;
  /** Ya formateado con `formatPlayerName`, igual que `PendingErasure.playerName`. */
  playerName: string;
  clubId: string;
  clubName: string;
};

export type AccountDeletionPreviewResult =
  | { ok: true; blockers: AccountDeletionBlocker[] }
  | { ok: false; raw: unknown };

/** `preview_account_deletion()` — sin efectos. Alimenta la pantalla de confirmación. */
export async function previewAccountDeletionFromClient(
  supabase: DbClient,
): Promise<AccountDeletionPreviewResult> {
  const { data, error } = await supabase.rpc('preview_account_deletion');
  if (error) return { ok: false, raw: error };
  const rows = data ?? [];
  return {
    ok: true,
    blockers: rows.map((r) => ({
      playerId: r.player_id,
      playerName: formatPlayerName(r.first_name, r.last_name),
      clubId: r.club_id,
      clubName: r.club_name,
    })),
  };
}

/**
 * Estado del borrado EN CURSO. `pendingPlayers` son las supresiones enlazadas que el
 * club aún no ha decidido; llegado `deadlineAt` la cuenta se anonimiza igual.
 */
export type AccountDeletionStatus = {
  requestId: string;
  requestedAt: string;
  deadlineAt: string;
  pendingPlayers: number;
};

export type AccountDeletionStatusResult =
  | { ok: true; status: AccountDeletionStatus | null }
  | { ok: false; raw: unknown };

/** `my_account_deletion_status()` — cero filas si no hay borrado pendiente. */
export async function getMyAccountDeletionStatusFromClient(
  supabase: DbClient,
): Promise<AccountDeletionStatusResult> {
  const { data, error } = await supabase.rpc('my_account_deletion_status');
  if (error) return { ok: false, raw: error };
  const row = data?.[0];
  if (!row) return { ok: true, status: null };
  return {
    ok: true,
    status: {
      requestId: row.request_id,
      requestedAt: row.requested_at,
      deadlineAt: row.deadline_at,
      pendingPlayers: row.pending_players,
    },
  };
}
