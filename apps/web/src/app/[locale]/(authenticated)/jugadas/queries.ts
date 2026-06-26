/**
 * F13.2 — Queries del editor de jugadas (playbook).
 *
 * Lee de `plays` (F13.1b) CONFIANDO en la RLS: no reimplementa permisos. La RLS
 * decide la visibilidad (autor/staff del club/staff del equipo; jugador/familia
 * solo `visibility='team'`). Aquí solo se scopea al club activo.
 */

import {
  parsePlay,
  emptyPlay,
  createSupabaseServerClient,
  getCurrentUser,
  type Play,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

/** Visibilidad de la jugada (columna de BD `plays.visibility`, D2). */
export type PlayVisibility = 'staff' | 'team';

// ── Equipos del club (selector del alta) ─────────────────────────────────────
export type ClubTeam = { id: string; name: string; season: string };

/** Equipos destinables a una jugada: SOLO los de la temporada ACTIVA. */
export async function loadClubTeams(clubId: string): Promise<ClubTeam[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);

  const { data } = await supabase
    .from('teams')
    .select('id, name, season')
    .eq('club_id', clubId)
    .eq('season', activeSeason)
    .order('name', { ascending: true });

  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    season: t.season as string,
  }));
}

// ── Biblioteca de jugadas (F13.5: búsqueda + filtros + paginación) ────────────
export const PLAYS_PAGE_SIZE = 20;

export type PlayListRow = {
  id: string;
  name: string | null;
  team_name: string | null;
  visibility: PlayVisibility;
  frame_count: number;
  updated_at: string;
  /** ¿El usuario actual es el autor? (para gatear el borrado por fila; la RLS es el gate real). */
  is_owner: boolean;
};

export type PlayListFilters = {
  search: string;
  teamId: string | null;
  visibility: PlayVisibility | null;
};

export type PlayListResult = { plays: PlayListRow[]; total: number };

/**
 * Lista la biblioteca de jugadas del club, CONFIANDO en la RLS (13.1b: staff ve
 * las de su club/equipos). Filtros por nombre (ilike), equipo y visibilidad;
 * paginación con .range() y count exacto (patrón F2.10, igual que /sesiones).
 * Orden por `updated_at` descendente.
 */
export async function loadPlays(
  clubId: string,
  filters: PlayListFilters,
  page: number,
): Promise<PlayListResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  // JR-0: plays pasa a banco del club (sin team_id/visibility). Los filtros por
  // equipo/visibilidad quedan como NO-OP hasta JR-1/JR-2 (la pantalla aún los
  // ofrece pero no recortan); team_name/visibility se rellenan con placeholders.
  let q = supabase
    .from('plays')
    .select('id, name, updated_at, play, owner_profile_id', { count: 'exact' })
    .eq('club_id', clubId);

  if (filters.search.trim().length > 0) {
    const escaped = filters.search.trim().replace(/[%_,]/g, (m) => `\\${m}`);
    q = q.ilike('name', `%${escaped}%`);
  }

  const from = (page - 1) * PLAYS_PAGE_SIZE;
  const to = from + PLAYS_PAGE_SIZE - 1;
  q = q.order('updated_at', { ascending: false }).range(from, to);

  const { data, count } = await q;

  const plays: PlayListRow[] = (data ?? []).map((p) => {
    const parsed = parsePlay(p.play);
    return {
      id: p.id as string,
      name: (p.name as string | null) ?? null,
      team_name: null, // JR-1/JR-2: el banco es del club; el equipo vive en team_plays
      visibility: 'staff', // JR-2: la visibilidad a familia pasa a team_plays.shared_with_family
      frame_count: parsed.success ? parsed.data.frames.length : 0,
      updated_at: p.updated_at as string,
      is_owner: !!user && p.owner_profile_id === user.id,
    };
  });

  return { plays, total: count ?? 0 };
}

// ── Una jugada para el editor ────────────────────────────────────────────────
export type PlayForEdit = {
  id: string;
  name: string | null;
  description: string | null;
  team_id: string;
  team_name: string | null;
  visibility: PlayVisibility;
  play: Play;
  is_owner: boolean;
};

export async function loadPlayForEdit(clubId: string, id: string): Promise<PlayForEdit | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  const { data } = await supabase
    .from('plays')
    .select('id, name, description, owner_profile_id, play')
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data) return null;

  const parsed = parsePlay(data.play);

  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    team_id: '', // JR-0: la jugada es del club; placeholder hasta rehacer el editor (JR-1)
    team_name: null,
    visibility: 'staff', // JR-2: visibilidad a familia pasa a team_plays
    // La forma fuerte está garantizada por parsePlay al guardar; si por lo que
    // fuese el jsonb no parsea, se cae a una jugada vacía válida (no rompe el UI).
    play: parsed.success ? parsed.data : emptyPlay(),
    is_owner: user?.id === (data.owner_profile_id as string),
  };
}

// ── Playbook del jugador/familia (F13.6, read-only) ───────────────────────────
export type PlaybookRow = {
  id: string;
  name: string | null;
  frame_count: number;
  updated_at: string;
};

/**
 * Jugadas del playbook del equipo COMPARTIDAS con la familia, para el Playbook del
 * jugador/familia. JR-0: ahora vía `team_plays` (shared_with_family=true) en vez de
 * `plays.visibility`. Confía en la RLS de team_plays (familia ve solo las
 * compartidas de su equipo). Orden por `updated_at` de la jugada desc.
 */
export async function loadTeamPlaybook(_clubId: string, teamId: string): Promise<PlaybookRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('team_plays')
    .select('play:plays!inner(id, name, play, updated_at)')
    .eq('team_id', teamId)
    .eq('shared_with_family', true);

  const rows = (data ?? [])
    .map((tp) => tp.play as unknown as { id: string; name: string | null; play: unknown; updated_at: string } | null)
    .filter((p): p is { id: string; name: string | null; play: unknown; updated_at: string } => p != null)
    .map((p) => {
      const parsed = parsePlay(p.play);
      return {
        id: p.id,
        name: p.name ?? null,
        frame_count: parsed.success ? parsed.data.frames.length : 0,
        updated_at: p.updated_at,
      };
    });
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return rows;
}

export type TeamPlay = { id: string; name: string | null; play: Play };

/**
 * Una jugada para la vista READ-ONLY del jugador/familia. JR-0: la defensa pasa a
 * `team_plays` — solo es visible si está en el playbook de algún equipo del jugador
 * con shared_with_family=true (la RLS de team_plays lo garantiza). Devuelve null si
 * no existe / no está compartida con la familia.
 */
export async function loadTeamPlay(clubId: string, id: string): Promise<TeamPlay | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: share } = await supabase
    .from('team_plays')
    .select('play_id')
    .eq('play_id', id)
    .eq('shared_with_family', true)
    .limit(1)
    .maybeSingle();
  if (!share) return null;

  const { data } = await supabase
    .from('plays')
    .select('id, name, play')
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();
  if (!data) return null;

  const parsed = parsePlay(data.play);
  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    play: parsed.success ? parsed.data : emptyPlay(),
  };
}
