import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decidePlayerErasureFromClient,
  createSupabaseAdminClient,
  type Database,
  type ErasureOutcome,
} from '@misterfc/core';
import { finalizeDueAccountDeletions } from '@/lib/account-deletion';

/**
 * O2-11c-2 — Wrapper web de la decisión de supresión (core). Único punto que inyecta
 * el borrado del OBJETO de foto con SERVICE-ROLE (`createSupabaseAdminClient().storage
 * .remove`), que core llama DESPUÉS de la RPC y solo al aprobar. Lo usan la Server
 * Action (cookie) y los route handlers nativos (bearer): misma RPC, mismo borrado,
 * mismo logging. Extraído del inline de `supresiones/actions.ts` (F14-7) SIN cambiar
 * su comportamiento (best-effort: si el objeto no se borra, la supresión NO se
 * revierte; se logea para limpieza manual).
 */

type Supa = SupabaseClient<Database>;

const removePhotoAdmin = async (photoPath: string): Promise<void> => {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from('player-photos').remove([photoPath]);
  if (error) throw new Error(error.message);
};

const logErasure = (error: unknown, step: string, extra: Record<string, unknown>) => {
  console.error(`[erasure] ${step}`, { ...extra, error });
};

/**
 * BC-3/BC-4 — decidir una supresión puede DESBLOQUEAR un borrado de cuenta: si era la
 * última que lo tenía en espera, la cuenta se anonimiza en el acto, sin esperar al cron
 * de los 30 días.
 *
 * Vale tanto al APROBAR como al RECHAZAR (decisión de Jose): el rechazo es sobre el dato
 * del MENOR, no sobre el derecho del titular a irse, así que en cuanto la solicitud deja
 * de estar `pending` la cuenta puede completarse.
 *
 * Va AQUÍ y no en los callers porque por esta función pasan los tres caminos —la Server
 * Action de /supresiones y los dos route handlers de la nativa—: en los callers habría
 * que acordarse tres veces. Best-effort: la supresión YA está aplicada y no se revierte
 * pase lo que pase aquí.
 */
export async function decideErasureWeb(
  supabase: Supa,
  requestId: string,
  approve: boolean,
  reason: string | null,
): Promise<ErasureOutcome> {
  const outcome = await decidePlayerErasureFromClient(
    supabase,
    requestId,
    approve,
    reason,
    removePhotoAdmin,
    logErasure,
  );
  if (!outcome.success) return outcome;

  try {
    const fin = await finalizeDueAccountDeletions();
    if (fin.succeeded > 0 || fin.failed > 0) {
      console.info('[erasure] borrados de cuenta rematados', { requestId, ...fin });
    }
  } catch (e) {
    logErasure(e, 'finalize_due_account_deletions', { requestId });
  }
  return outcome;
}

/**
 * GATE admin_club-ONLY de la app para las supresiones (más estricto que la RPC, que
 * admite admin+director). Deriva el club de la solicitud CON EL CLIENTE DEL USUARIO
 * (RLS) y comprueba que su rol de membresía en ese club es `admin_club`. Devuelve el
 * clubId si procede, o `null` (→ 403). Un director → null (rechazado). Se usa en los
 * route handlers ANTES de llamar a la RPC/al borrado.
 */
export async function resolveErasureAdminClub(
  supabase: Supa,
  userId: string,
  requestId: string,
): Promise<string | null> {
  const { data: reqRow } = await supabase
    .from('erasure_requests')
    .select('club_id')
    .eq('id', requestId)
    .maybeSingle();
  const clubId = (reqRow?.club_id as string | undefined) ?? null;
  if (!clubId) return null;

  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('profile_id', userId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (!membership || membership.role !== 'admin_club') return null;
  return clubId;
}
