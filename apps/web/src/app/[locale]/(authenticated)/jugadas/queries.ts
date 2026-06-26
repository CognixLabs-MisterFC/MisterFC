/**
 * JR-1 — Queries de la biblioteca de jugadas (banco del club con ciclo, ADR-0019).
 *
 * Lee de `plays` CONFIANDO en la RLS por estado (JR-0): no reimplementa permisos.
 * La RLS decide QUÉ filas se ven (borrador→autor; propuesta/rechazada→autor∪
 * aprobador; publicada→todo el staff). Aquí solo se scopea al club y se aplican
 * los filtros de UI (búsqueda + estado). El playbook de familia (loadTeamPlaybook
 * / loadTeamPlay) sigue sobre `team_plays` (JR-2) y no cambia aquí.
 */

import {
  parsePlay,
  emptyPlay,
  createSupabaseServerClient,
  getCurrentUser,
  type Play,
  type MethodologyStatus,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ── Biblioteca de jugadas (búsqueda + filtro por estado + paginación) ─────────
export const PLAYS_PAGE_SIZE = 20;

/** Filtro de estado de la UI: los 4 estados del ciclo + 'archived' (archived_at). */
export type PlayStatusFilter = MethodologyStatus | 'archived';

export type PlayListRow = {
  id: string;
  name: string | null;
  status: MethodologyStatus;
  /** Publicada y archivada (archived_at != null) → badge propio. */
  archived: boolean;
  frame_count: number;
  updated_at: string;
  /** ¿El usuario actual es el autor? (para gatear el borrado por fila; la RLS es el gate real). */
  is_owner: boolean;
};

export type PlayListFilters = {
  search: string;
  status: PlayStatusFilter | null;
};

export type PlayListResult = { plays: PlayListRow[]; total: number };

/**
 * Lista la biblioteca de jugadas del club, CONFIANDO en la RLS (JR-0: el staff ve
 * las publicadas; autor/aprobador ven además las del ciclo). Filtros por nombre
 * (ilike) y por estado; paginación con .range() + count exacto (patrón F2.10).
 * Orden por `updated_at` descendente. Por defecto excluye archivadas (salvo que el
 * filtro sea 'archived'). `proposedOnly` (cola de revisión) fuerza status='proposed'.
 */
export async function loadPlays(
  clubId: string,
  filters: PlayListFilters,
  page: number,
  proposedOnly = false,
): Promise<PlayListResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  let q = supabase
    .from('plays')
    .select('id, name, status, updated_at, play, owner_profile_id, archived_at', { count: 'exact' })
    .eq('club_id', clubId);

  if (proposedOnly) {
    // Cola de revisión: solo propuestas vivas.
    q = q.eq('status', 'proposed').is('archived_at', null);
  } else if (filters.status === 'archived') {
    q = q.not('archived_at', 'is', null);
  } else {
    q = q.is('archived_at', null);
    if (filters.status != null) q = q.eq('status', filters.status);
  }

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
      status: p.status as MethodologyStatus,
      archived: (p.archived_at as string | null) != null,
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
  status: MethodologyStatus;
  /** Publicada y archivada. */
  archived: boolean;
  /** Motivo del último rechazo (si status='rejected'). */
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  play: Play;
  is_owner: boolean;
};

export async function loadPlayForEdit(clubId: string, id: string): Promise<PlayForEdit | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);

  const { data } = await supabase
    .from('plays')
    .select(
      `id, name, description, status, archived_at, rejection_reason, approved_at,
       owner_profile_id, play,
       approved_by_profile:profiles!plays_approved_by_fkey(full_name)`,
    )
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data) return null;

  const parsed = parsePlay(data.play);
  const approver = data.approved_by_profile as { full_name: string | null } | null;

  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    status: data.status as MethodologyStatus,
    archived: (data.archived_at as string | null) != null,
    rejection_reason: (data.rejection_reason as string | null) ?? null,
    approved_at: (data.approved_at as string | null) ?? null,
    approved_by_name: approver?.full_name ?? null,
    // La forma fuerte está garantizada por parsePlay al guardar; si por lo que
    // fuese el jsonb no parsea, se cae a una jugada vacía válida (no rompe el UI).
    play: parsed.success ? parsed.data : emptyPlay(),
    is_owner: user?.id === (data.owner_profile_id as string),
  };
}

// ── Playbook del equipo (JR-2, gestión por staff) ─────────────────────────────
export type TeamSelectedPlay = {
  play_id: string;
  name: string | null;
  frame_count: number;
  shared_with_family: boolean;
  updated_at: string;
};

/**
 * JR-2 — Jugadas que un EQUIPO ha seleccionado del banco (todas, con su flag
 * shared_with_family), para que el staff gestione su playbook. La RLS de team_plays
 * (JR-0) decide quién ve qué: staff del equipo ∪ admin/coord ven TODAS; la familia
 * solo las compartidas (esta vista es para staff). Orden por jugada desc.
 */
export async function loadTeamSelectedPlays(teamId: string): Promise<TeamSelectedPlay[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('team_plays')
    .select('play_id, shared_with_family, play:plays!inner(id, name, play, updated_at)')
    .eq('team_id', teamId);

  const rows = (data ?? [])
    .map((tp) => {
      const p = tp.play as unknown as
        | { id: string; name: string | null; play: unknown; updated_at: string }
        | null;
      if (!p) return null;
      const parsed = parsePlay(p.play);
      return {
        play_id: p.id,
        name: p.name ?? null,
        frame_count: parsed.success ? parsed.data.frames.length : 0,
        shared_with_family: tp.shared_with_family as boolean,
        updated_at: p.updated_at,
      } satisfies TeamSelectedPlay;
    })
    .filter((r): r is TeamSelectedPlay => r != null);
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return rows;
}

export type AddablePlay = {
  id: string;
  name: string | null;
  frame_count: number;
  updated_at: string;
};

/** Tope de resultados del buscador del banco (set modesto por club; con búsqueda basta). */
export const ADDABLE_PLAYS_LIMIT = 50;

/**
 * JR-2 — Jugadas PUBLICADAS del banco del club (no archivadas) que el equipo AÚN NO
 * tiene en su playbook, para el añadir-del-banco del staff. Búsqueda por nombre.
 * La RLS deja ver las publicadas a todo el staff del club; aquí solo se scopea y se
 * excluyen las ya seleccionadas. Limitado a ADDABLE_PLAYS_LIMIT (con búsqueda basta).
 */
export async function loadAddablePublishedPlays(
  clubId: string,
  teamId: string,
  search: string,
): Promise<AddablePlay[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: existing } = await supabase
    .from('team_plays')
    .select('play_id')
    .eq('team_id', teamId);
  const have = new Set((existing ?? []).map((r) => r.play_id as string));

  let q = supabase
    .from('plays')
    .select('id, name, play, updated_at')
    .eq('club_id', clubId)
    .eq('status', 'published')
    .is('archived_at', null);

  if (search.trim().length > 0) {
    const escaped = search.trim().replace(/[%_,]/g, (m) => `\\${m}`);
    q = q.ilike('name', `%${escaped}%`);
  }
  q = q.order('updated_at', { ascending: false }).limit(ADDABLE_PLAYS_LIMIT);

  const { data } = await q;
  return (data ?? [])
    .filter((p) => !have.has(p.id as string))
    .map((p) => {
      const parsed = parsePlay(p.play);
      return {
        id: p.id as string,
        name: (p.name as string | null) ?? null,
        frame_count: parsed.success ? parsed.data.frames.length : 0,
        updated_at: p.updated_at as string,
      };
    });
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
 * jugador/familia. JR-0: vía `team_plays` (shared_with_family=true). Confía en la
 * RLS de team_plays (familia ve solo las compartidas de su equipo). Orden por
 * `updated_at` de la jugada desc. (Sin cambios en JR-1; el alta de team_plays es JR-2.)
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
