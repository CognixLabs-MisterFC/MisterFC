import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decidePlayerErasureFromClient,
  createSupabaseAdminClient,
  type Database,
  type ErasureOutcome,
} from '@misterfc/core';

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

export function decideErasureWeb(
  supabase: Supa,
  requestId: string,
  approve: boolean,
  reason: string | null,
): Promise<ErasureOutcome> {
  return decidePlayerErasureFromClient(
    supabase,
    requestId,
    approve,
    reason,
    removePhotoAdmin,
    logErasure,
  );
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
