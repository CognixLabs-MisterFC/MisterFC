/**
 * F6 Lote A — Carga del editor de alineación de un partido.
 *
 * Permission gate autoritativo vía RPC `user_can_manage_lineup` (mismo helper
 * SQL que la RLS). Roster a la fecha del partido (patrón F4). Si el evento no
 * es válido o el user no gestiona → null (la página hace notFound).
 */

import {
  createSupabaseServerClient,
  type LineupLocation,
  type OutReason,
  type PlayerPositionMain,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type RosterPlayer = {
  playerId: string;
  firstName: string;
  lastName: string;
  dorsal: number | null;
  positionMain: PlayerPositionMain;
};

export type LineupSummary = {
  id: string;
  name: string;
  formationCode: string;
  isOfficial: boolean;
  visibility: 'staff' | 'team';
};

export type PlannedSubRow = {
  id: string;
  minutePlanned: number;
  playerOutId: string;
  playerInId: string;
  positionCodeTarget: string | null;
};

export type LineupPositionRow = {
  playerId: string;
  location: LineupLocation;
  positionCode: string | null;
  xPct: number | null;
  yPct: number | null;
  outReason: OutReason | null;
};

export type LineupEditorData = {
  event: {
    id: string;
    teamId: string;
    title: string;
    opponentName: string | null;
    startsAt: string;
    teamName: string;
    teamColor: string;
    categoryName: string;
    categorySeason: string;
    format: TeamFormat;
  };
  roster: RosterPlayer[];
  lineups: LineupSummary[];
  selectedLineupId: string | null;
  positions: LineupPositionRow[];
  tacticalNotes: string | null;
  plannedSubs: PlannedSubRow[];
  /** La convocatoria del partido está publicada (gate de auto-marcado 6.6). */
  callupPublished: boolean;
};

export async function loadLineupEditor(
  clubId: string,
  eventId: string,
  preferredLineupId: string | null,
): Promise<LineupEditorData | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, title, opponent_name, starts_at,
       teams!inner(name, color, format, categories!inner(name, season))`,
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (ev.type !== 'match' || ev.team_id == null) return null;

  type EventShape = {
    id: string;
    team_id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: {
      name: string;
      color: string;
      format: TeamFormat;
      categories: { name: string; season: string };
    };
  };
  const event = ev as unknown as EventShape;

  // Permiso autoritativo (mismo helper que la RLS).
  const { data: canManage } = await supabase.rpc('user_can_manage_lineup', {
    p_event_id: eventId,
  });
  if (canManage !== true) return null;

  // Roster a la fecha del partido.
  const eventDate = event.starts_at.slice(0, 10);
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'player_id, joined_at, left_at, players!inner(id, first_name, last_name, dorsal, position_main)',
    )
    .eq('team_id', event.team_id)
    .lte('joined_at', eventDate);
  type RosterShape = {
    player_id: string;
    joined_at: string;
    left_at: string | null;
    players: {
      id: string;
      first_name: string;
      last_name: string;
      dorsal: number | null;
      position_main: PlayerPositionMain;
    };
  };
  const roster: RosterPlayer[] = (rosterRows ?? [])
    .map((r) => r as unknown as RosterShape)
    .filter((r) => r.left_at == null || r.left_at >= eventDate)
    .map((r) => ({
      playerId: r.player_id,
      firstName: r.players.first_name,
      lastName: r.players.last_name,
      dorsal: r.players.dorsal,
      positionMain: r.players.position_main,
    }));

  // Alineaciones del evento.
  const { data: lineupRows } = await supabase
    .from('lineups')
    .select('id, name, formation_code, is_official, visibility, created_at')
    .eq('event_id', eventId)
    .order('is_official', { ascending: false })
    .order('created_at', { ascending: true });
  type LineupShape = {
    id: string;
    name: string;
    formation_code: string;
    is_official: boolean;
    visibility: 'staff' | 'team';
    created_at: string;
  };
  const lineups: LineupSummary[] = (lineupRows ?? [])
    .map((l) => l as unknown as LineupShape)
    .map((l) => ({
      id: l.id,
      name: l.name,
      formationCode: l.formation_code,
      isOfficial: l.is_official,
      visibility: l.visibility,
    }));

  // Alineación seleccionada: la pedida (si existe) → la oficial → la primera.
  const selected =
    lineups.find((l) => l.id === preferredLineupId) ??
    lineups.find((l) => l.isOfficial) ??
    lineups[0] ??
    null;

  let positions: LineupPositionRow[] = [];
  if (selected) {
    const { data: posRows } = await supabase
      .from('lineup_positions')
      .select('player_id, location, position_code, x_pct, y_pct, out_reason')
      .eq('lineup_id', selected.id);
    type PosShape = {
      player_id: string;
      location: LineupLocation;
      position_code: string | null;
      x_pct: number | string | null;
      y_pct: number | string | null;
      out_reason: OutReason | null;
    };
    positions = (posRows ?? [])
      .map((p) => p as unknown as PosShape)
      .map((p) => ({
        playerId: p.player_id,
        location: p.location,
        positionCode: p.position_code,
        xPct: p.x_pct == null ? null : Number(p.x_pct),
        yPct: p.y_pct == null ? null : Number(p.y_pct),
        outReason: p.out_reason,
      }));
  }

  // Notas tácticas + cambios programados de la alineación seleccionada.
  let tacticalNotes: string | null = null;
  let plannedSubs: PlannedSubRow[] = [];
  if (selected) {
    const [{ data: notesRow }, { data: subRows }] = await Promise.all([
      supabase
        .from('lineup_tactical_notes')
        .select('notes')
        .eq('lineup_id', selected.id)
        .maybeSingle(),
      supabase
        .from('planned_substitutions')
        .select('id, minute_planned, player_out_id, player_in_id, position_code_target')
        .eq('lineup_id', selected.id)
        .order('minute_planned', { ascending: true }),
    ]);
    tacticalNotes = (notesRow?.notes as string | undefined) ?? null;
    type SubShape = {
      id: string;
      minute_planned: number;
      player_out_id: string;
      player_in_id: string;
      position_code_target: string | null;
    };
    plannedSubs = (subRows ?? [])
      .map((s) => s as unknown as SubShape)
      .map((s) => ({
        id: s.id,
        minutePlanned: s.minute_planned,
        playerOutId: s.player_out_id,
        playerInId: s.player_in_id,
        positionCodeTarget: s.position_code_target,
      }));
  }

  // ¿Convocatoria publicada? (gate del auto-marcado 6.6 en el editor.)
  const { data: metaRow } = await supabase
    .from('match_callup_meta')
    .select('published_at')
    .eq('event_id', eventId)
    .maybeSingle();
  const callupPublished = metaRow?.published_at != null;

  return {
    event: {
      id: event.id,
      teamId: event.team_id,
      title: event.title,
      opponentName: event.opponent_name,
      startsAt: event.starts_at,
      teamName: event.teams.name,
      teamColor: event.teams.color,
      categoryName: event.teams.categories.name,
      categorySeason: event.teams.categories.season,
      format: event.teams.format,
    },
    roster,
    lineups,
    selectedLineupId: selected?.id ?? null,
    positions,
    tacticalNotes,
    plannedSubs,
    callupPublished,
  };
}
