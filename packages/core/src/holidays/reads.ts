/**
 * O2-11c-1 — Lectura de la COLA de entrenos en festivo PENDIENTES de aprobar
 * (club-wide, solo lectura), para la pantalla de calendario de dirección nativa.
 * Espeja `loadPendingApprovals` (direccion-home-queries) sin el filtro por equipo:
 * dirección la ve completa. La lista de festivos ya la da `getHolidaysFromClient`
 * (módulo calendar).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type DbClient = SupabaseClient<Database>;

export type PendingApprovalItem = {
  eventId: string;
  title: string;
  startsAt: string;
  teamName: string | null;
};

export async function getPendingHolidayApprovalsFromClient(
  supabase: DbClient,
  clubId: string,
): Promise<PendingApprovalItem[]> {
  const { data } = await supabase
    .from('events')
    .select('id, title, starts_at, team_id, teams(name)')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .eq('approval_status', 'pending')
    .order('starts_at', { ascending: true });

  type Row = {
    id: string;
    title: string;
    starts_at: string;
    teams: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((e) => ({
    eventId: e.id,
    title: e.title,
    startsAt: e.starts_at,
    teamName: e.teams?.name ?? null,
  }));
}
