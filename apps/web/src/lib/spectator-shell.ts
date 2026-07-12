import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import {
  ACTIVE_PLAYER_COOKIE_NAME,
  createSupabaseServerClient,
  getCurrentUser,
  getCurrentUserClubs,
  resolveActivePlayer,
  type FollowedPlayer,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { ShellProfile } from '@/lib/auth-shell';

export type SpectatorContext = {
  user: User;
  profile: ShellProfile;
  /** Jugadores que sigue (orden estable por nombre). */
  players: FollowedPlayer[];
  /** Nieto activo (cookie `active_player_id`, con fallback al primero). */
  activePlayer: FollowedPlayer;
  staleCookie: boolean;
};

/**
 * F14C-4 — Carga el contexto del SEGUIDOR PURO.
 *
 * "Seguidor puro" = is_spectator() Y SIN ninguna membership de club. La
 * PRIORIDAD ES DEL ROL: si el user tiene cualquier membership, esto devuelve
 * null y el shell normal manda (un tutor/jugador que además sigue a otro niño
 * NO ve el shell reducido — eso será F14C-5).
 *
 * Devuelve null si: no hay sesión, tiene membership, no es espectador, o no
 * sigue a ningún jugador. El llamador (layout de /spectator) decide el destino.
 *
 * Los datos de jugador salen SOLO de `players_sporting` (F14C-3): nombre y club,
 * nada personal. `players` sigue cerrada al seguidor.
 */
export async function loadSpectatorContext(): Promise<SpectatorContext | null> {
  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) return null;

  // PRIORIDAD AL ROL — con cualquier membership NO es seguidor puro.
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length > 0) return null;

  const supabase = createSupabaseServerClient(adapter);
  const { data: isSpec } = await supabase.rpc('is_spectator');
  if (isSpec !== true) return null;

  // Jugadores seguidos: player_spectators (RLS: solo filas propias del seguidor).
  const { data: links } = await supabase
    .from('player_spectators')
    .select('player_id')
    .eq('spectator_profile_id', user.id);
  const playerIds = (links ?? []).map((l) => l.player_id);
  if (playerIds.length === 0) return null;

  // Nombre + club por la vista deportiva (nada personal).
  const { data: sportRows } = await supabase
    .from('players_sporting')
    .select('id, club_id, first_name, last_name')
    .in('id', playerIds);

  // Equipo ACTIVO de cada jugador: team_members (RLS abierta al seguidor por
  // is_spectator_of_players_club, F14C-3) + nombre del equipo desde teams.
  const { data: tmRows } = await supabase
    .from('team_members')
    .select('player_id, team_id')
    .in('player_id', playerIds)
    .is('left_at', null);
  const teamOfPlayer = new Map<string, string>();
  for (const r of tmRows ?? []) {
    if (!teamOfPlayer.has(r.player_id)) teamOfPlayer.set(r.player_id, r.team_id);
  }
  const teamIds = [...new Set([...teamOfPlayer.values()])];
  const teamNameById = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', teamIds);
    for (const t of teamRows ?? []) teamNameById.set(t.id, t.name);
  }

  const players: FollowedPlayer[] = (sportRows ?? [])
    .filter((p): p is typeof p & { id: string } => p.id != null)
    .map((p) => {
      const teamId = teamOfPlayer.get(p.id) ?? null;
      const fullName =
        [p.first_name, p.last_name].filter(Boolean).join(' ').trim() ||
        '—';
      return {
        playerId: p.id,
        clubId: p.club_id ?? '',
        fullName,
        teamId,
        teamName: teamId ? (teamNameById.get(teamId) ?? null) : null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  if (players.length === 0) return null;

  const cookieStore = await cookies();
  const cookieValue =
    cookieStore.get(ACTIVE_PLAYER_COOKIE_NAME)?.value ?? null;
  const { active, staleCookie } = resolveActivePlayer(players, cookieValue);
  if (!active) return null;

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, date_of_birth, locale')
    .eq('id', user.id)
    .maybeSingle();

  const profile: ShellProfile = {
    full_name: profileRow?.full_name ?? null,
    avatar_url: profileRow?.avatar_url ?? null,
    date_of_birth: profileRow?.date_of_birth ?? null,
    locale: profileRow?.locale ?? 'es',
  };

  return { user, profile, players, activePlayer: active, staleCookie };
}

/**
 * Detección LIGERA para el rutado de entrada: ¿es el user un seguidor puro
 * (sin membership) que debe ir a /spectator en vez de a /onboarding? Solo dos
 * RPCs baratas; no carga jugadores. Se usa en la rama `!ctx` del layout
 * autenticado, que solo se ejecuta cuando el shell normal no tiene club.
 */
export async function isPureSpectator(): Promise<boolean> {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length > 0) return false;
  const supabase = createSupabaseServerClient(adapter);
  const { data: isSpec } = await supabase.rpc('is_spectator');
  return isSpec === true;
}
