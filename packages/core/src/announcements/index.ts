import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

/**
 * O2-5 B1 — Anuncios (lectura), extraído de `apps/web` (Inicio + /anuncios). La
 * RLS filtra a los que el usuario ve (club-wide + equipos del jugador). Family no
 * publica: aquí solo lectura.
 */
type DbClient = SupabaseClient<Database>;

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  team_id: string | null;
  created_at: string;
  expires_at: string | null;
  teamName: string | null;
};

type RawAnn = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  team_id: string | null;
  created_at: string;
  expires_at?: string | null;
  teams: { name: string } | null;
};

function mapAnn(rows: RawAnn[]): AnnouncementRow[] {
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    team_id: a.team_id,
    created_at: a.created_at,
    expires_at: a.expires_at ?? null,
    teamName: a.teams?.name ?? null,
  }));
}

/** Anuncios recientes para el panel de Inicio (últimos `sinceDays` días, top N). */
export async function getRecentAnnouncementsFromClient(
  supabase: DbClient,
  clubId: string,
  opts?: { sinceIso?: string; limit?: number }
): Promise<AnnouncementRow[]> {
  let q = supabase
    .from('announcements')
    .select('id, title, body, pinned, team_id, created_at, teams(name)')
    .eq('club_id', clubId);
  if (opts?.sinceIso) q = q.gte('created_at', opts.sinceIso);
  const { data } = await q
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 5);
  return mapAnn((data ?? []) as unknown as RawAnn[]);
}

/** Lista de anuncios para la pantalla /anuncios (family: sin filtro de scope). */
export async function getAnnouncementsListFromClient(
  supabase: DbClient,
  clubId: string,
  opts?: { sinceIso?: string; limit?: number }
): Promise<AnnouncementRow[]> {
  let q = supabase
    .from('announcements')
    .select(
      'id, title, body, pinned, expires_at, created_at, team_id, teams(name)'
    )
    .eq('club_id', clubId);
  if (opts?.sinceIso) q = q.gte('created_at', opts.sinceIso);
  const { data } = await q
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 100);
  return mapAnn((data ?? []) as unknown as RawAnn[]);
}
