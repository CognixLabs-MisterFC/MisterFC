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

  let q = supabase
    .from('plays')
    .select('id, name, visibility, updated_at, play, owner_profile_id, team:teams(name)', {
      count: 'exact',
    })
    .eq('club_id', clubId);

  if (filters.search.trim().length > 0) {
    const escaped = filters.search.trim().replace(/[%_,]/g, (m) => `\\${m}`);
    q = q.ilike('name', `%${escaped}%`);
  }
  if (filters.teamId) q = q.eq('team_id', filters.teamId);
  if (filters.visibility) q = q.eq('visibility', filters.visibility);

  const from = (page - 1) * PLAYS_PAGE_SIZE;
  const to = from + PLAYS_PAGE_SIZE - 1;
  q = q.order('updated_at', { ascending: false }).range(from, to);

  const { data, count } = await q;

  const plays: PlayListRow[] = (data ?? []).map((p) => {
    const team = p.team as { name: string } | null;
    const parsed = parsePlay(p.play);
    return {
      id: p.id as string,
      name: (p.name as string | null) ?? null,
      team_name: team?.name ?? null,
      visibility: p.visibility as PlayVisibility,
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
    .select('id, name, description, team_id, visibility, owner_profile_id, play, team:teams(name)')
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data) return null;

  const team = data.team as { name: string } | null;
  const parsed = parsePlay(data.play);

  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    team_id: data.team_id as string,
    team_name: team?.name ?? null,
    visibility: data.visibility as PlayVisibility,
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
 * Jugadas PUBLICADAS (visibility='team') del equipo, para el Playbook del
 * jugador/familia. Confía en la RLS (13.1b): el jugador solo ve las team de su
 * equipo. Orden por `updated_at` desc.
 */
export async function loadTeamPlaybook(clubId: string, teamId: string): Promise<PlaybookRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('plays')
    .select('id, name, play, updated_at')
    .eq('club_id', clubId)
    .eq('team_id', teamId)
    .eq('visibility', 'team')
    .order('updated_at', { ascending: false });

  return (data ?? []).map((p) => {
    const parsed = parsePlay(p.play);
    return {
      id: p.id as string,
      name: (p.name as string | null) ?? null,
      frame_count: parsed.success ? parsed.data.frames.length : 0,
      updated_at: p.updated_at as string,
    };
  });
}

export type TeamPlay = { id: string; name: string | null; play: Play };

/**
 * Una jugada para la vista READ-ONLY del jugador/familia. Confía en la RLS, más
 * una defensa explícita: solo si visibility='team' (igual que el visor de sesiones
 * del jugador). Devuelve null si no existe / no es visible.
 */
export async function loadTeamPlay(clubId: string, id: string): Promise<TeamPlay | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('plays')
    .select('id, name, visibility, play')
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data || data.visibility !== 'team') return null;

  const parsed = parsePlay(data.play);
  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    play: parsed.success ? parsed.data : emptyPlay(),
  };
}
