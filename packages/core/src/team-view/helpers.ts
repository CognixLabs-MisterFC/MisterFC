/**
 * F5.8 — Helpers puros para la vista "Mi equipo" del jugador.
 *
 * Cero side-effects, cero BD. Reciben arrays ya cargados por el server
 * component y devuelven la forma agregada que necesita la UI. Esto
 * permite testarlos con vitest sin tocar Supabase.
 */

export type TeammateInput = {
  id: string;
  first_name: string;
  last_name: string | null;
  dorsal: number | null;
  photo_url: string | null;
};

export type TeammateCard = {
  id: string;
  full_name: string;
  dorsal: number | null;
  photo_url: string | null;
};

/**
 * Lista compañeros del player actual: excluye al propio jugador y ordena
 * por dorsal asc (los sin dorsal al final) → luego full_name asc.
 */
export function listTeammates(
  players: ReadonlyArray<TeammateInput>,
  currentPlayerId: string,
): TeammateCard[] {
  return players
    .filter((p) => p.id !== currentPlayerId)
    .map((p) => ({
      id: p.id,
      full_name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      dorsal: p.dorsal,
      photo_url: p.photo_url,
    }))
    .sort((a, b) => {
      const aDorsal = a.dorsal ?? Number.POSITIVE_INFINITY;
      const bDorsal = b.dorsal ?? Number.POSITIVE_INFINITY;
      if (aDorsal !== bDorsal) return aDorsal - bDorsal;
      return a.full_name.localeCompare(b.full_name);
    });
}

export type TeamEventInput = {
  id: string;
  title: string;
  type: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string | null;
  opponent_name: string | null;
};

export type TeamEventCard = TeamEventInput;

/**
 * Filtra a futuros (>= nowIso) dentro de horizonDays y los ordena ASC,
 * con `limit` (default 10).
 */
export function listUpcomingTeamEvents(
  events: ReadonlyArray<TeamEventInput>,
  nowIso: string,
  horizonDays = 30,
  limit = 10,
): TeamEventCard[] {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [];
  const horizonMs = nowMs + horizonDays * 24 * 3600 * 1000;
  return events
    .filter((e) => {
      const t = Date.parse(e.starts_at);
      return Number.isFinite(t) && t >= nowMs && t <= horizonMs;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, limit);
}

export type TeamAnnouncementInput = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  team_id: string | null;
  created_at: string;
  team_name?: string | null;
};

export type AnnouncementCard = TeamAnnouncementInput;

/**
 * Filtra anuncios visibles para el jugador (club-wide o de uno de sus
 * teams), dedupe por id, pinned-first, created_at desc, limit (default 5).
 */
export function listVisibleAnnouncements(
  announcements: ReadonlyArray<TeamAnnouncementInput>,
  teamIds: ReadonlyArray<string>,
  limit = 5,
): AnnouncementCard[] {
  const teamSet = new Set(teamIds);
  const filtered = announcements.filter(
    (a) => a.team_id === null || teamSet.has(a.team_id),
  );
  const dedup = new Map<string, TeamAnnouncementInput>();
  for (const a of filtered) dedup.set(a.id, a);
  return Array.from(dedup.values())
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    })
    .slice(0, limit);
}
