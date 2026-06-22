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

// ── Listado (mínimo; la biblioteca completa con filtros es 13.5) ──────────────
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

export async function loadPlays(clubId: string): Promise<PlayListRow[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  const { data } = await supabase
    .from('plays')
    .select('id, name, visibility, updated_at, play, owner_profile_id, team:teams(name)')
    .eq('club_id', clubId)
    .order('updated_at', { ascending: false });

  return (data ?? []).map((p) => {
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
