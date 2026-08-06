/**
 * O2-11c-2 — Lectura de la bandeja de SOLICITUDES DE SUPRESIÓN pendientes (club-wide,
 * solo lectura) para la pantalla de dirección nativa. Espeja la query de
 * `supresiones/page.tsx` (F14-7). La RLS de `erasure_requests` deja a admin/director
 * ver las de su club; el gate admin_club-ONLY de la acción es aparte (route handler).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { formatPlayerName } from '../utils/name';

type DbClient = SupabaseClient<Database>;

export type PendingErasure = {
  id: string;
  requestedAt: string;
  reason: string | null;
  playerName: string;
  requesterName: string | null;
};

export async function getPendingErasuresFromClient(
  supabase: DbClient,
  clubId: string,
): Promise<PendingErasure[]> {
  const { data } = await supabase
    .from('erasure_requests')
    .select(
      'id, requested_at, reason, players!inner(first_name, last_name), requester:profiles!erasure_requests_requested_by_fkey(full_name)',
    )
    .eq('club_id', clubId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });

  type Row = {
    id: string;
    requested_at: string;
    reason: string | null;
    players: { first_name: string; last_name: string | null };
    requester: { full_name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    requestedAt: r.requested_at,
    reason: r.reason,
    playerName: formatPlayerName(r.players.first_name, r.players.last_name),
    requesterName: r.requester?.full_name ?? null,
  }));
}
