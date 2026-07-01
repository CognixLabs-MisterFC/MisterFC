/**
 * F6 — Carga del editor de alineación de un partido.
 *
 * Permission gate autoritativo vía RPC `user_can_manage_lineup` (mismo helper
 * SQL que la RLS). Roster a la fecha del partido (patrón F4). Si el evento no
 * es válido o el user no gestiona → null (la página hace notFound).
 *
 * Rediseño Lote B': la CONVOCATORIA es la fuente de verdad del roster. El
 * editor reparte a los convocados en campo/banquillo y expone un panel
 * "Descartados" (nivel evento, `callup_decisions`) compartido por TODAS las
 * alineaciones. Devolvemos el roster COMPLETO (para poder mostrar también a los
 * descartados) + la lista de descartados con su motivo.
 *
 * Las fotos (`players.photo_url`) son rutas del bucket privado `player-photos`:
 * se firman aquí (server, TTL corto) para que los chips puedan renderizarlas.
 */

import {
  createSupabaseServerClient,
  defaultLineupDraft,
  isManageableMatchType,
  type CoachFormation,
  type CoachFormationPosition,
  type LineupLocation,
  type PlayerPositionMain,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const PHOTO_TTL_SECONDS = 3600;

export type RosterPlayer = {
  playerId: string;
  firstName: string;
  lastName: string;
  dorsal: number | null;
  positionMain: PlayerPositionMain;
  /** URL firmada de la foto (o null). */
  photoUrl: string | null;
  /** D2.1 — true si el jugador está SUBIDO a este evento (no es del roster). */
  isPromoted?: boolean;
  /** D2.1 — nombre del equipo base del jugador subido (para el badge). */
  fromTeamName?: string | null;
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
};

/** Descartado a nivel EVENTO (callup_decisions.discarded), no por alineación. */
export type DiscardedPlayer = {
  playerId: string;
  reason: string | null;
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
  /** Roster COMPLETO a fecha (incluye descartados, para lookup de nombre/foto). */
  roster: RosterPlayer[];
  /** Descartados del evento (compartidos por todas las alineaciones). */
  discarded: DiscardedPlayer[];
  lineups: LineupSummary[];
  selectedLineupId: string | null;
  positions: LineupPositionRow[];
  tacticalNotes: string | null;
  plannedSubs: PlannedSubRow[];
  /** F6.10 — plantillas del coach para la modalidad del equipo. */
  coachFormations: CoachFormation[];
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
       teams!inner(name, color, format, season, categories!inner(name))`,
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (!isManageableMatchType(ev.type as string) || ev.team_id == null)
    return null;

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
      season: string;
      categories: { name: string };
    };
  };
  const event = ev as unknown as EventShape;

  // Permiso autoritativo (mismo helper que la RLS).
  const { data: canManage } = await supabase.rpc('user_can_manage_lineup', {
    p_event_id: eventId,
  });
  if (canManage !== true) return null;

  // Decisiones de convocatoria del evento — descartados (con motivo).
  const { data: decisionRows } = await supabase
    .from('callup_decisions')
    .select('player_id, decision, reason')
    .eq('event_id', eventId);
  const discarded: DiscardedPlayer[] = (decisionRows ?? [])
    .filter((d) => (d.decision as string) === 'discarded')
    .map((d) => ({
      playerId: d.player_id as string,
      reason: (d.reason as string | null) ?? null,
    }));
  const discardedSet = new Set(discarded.map((d) => d.playerId));

  // Roster COMPLETO a la fecha del partido (incluye descartados).
  const eventDate = event.starts_at.slice(0, 10);
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'player_id, joined_at, left_at, players!inner(id, first_name, last_name, dorsal, position_main, photo_url)',
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
      last_name: string | null;
      dorsal: number | null;
      position_main: PlayerPositionMain;
      photo_url: string | null;
    };
  };
  const rosterBase = (rosterRows ?? [])
    .map((r) => r as unknown as RosterShape)
    .filter((r) => r.left_at == null || r.left_at >= eventDate)
    .map((r) => ({
      playerId: r.player_id,
      firstName: r.players.first_name,
      lastName: r.players.last_name ?? '',
      dorsal: r.players.dorsal,
      positionMain: r.players.position_main,
      photoPath: r.players.photo_url,
      isPromoted: false,
      fromTeamName: null as string | null,
    }));

  // D2.1 — jugadores SUBIDOS a este evento (player_promotions): alineables como
  // uno más, sin estar en team_members. Se unen al roster con su equipo base.
  const { data: promoRows } = await supabase
    .from('player_promotions')
    .select(
      'player_id, players!inner(id, first_name, last_name, dorsal, position_main, photo_url, team_members(left_at, teams(name)))'
    )
    .eq('event_id', event.id);
  type PromoShape = {
    player_id: string;
    players: {
      id: string;
      first_name: string;
      last_name: string | null;
      dorsal: number | null;
      position_main: PlayerPositionMain;
      photo_url: string | null;
      team_members: { left_at: string | null; teams: { name: string } | null }[];
    };
  };
  const rosterPromoted = (promoRows ?? [])
    .map((r) => r as unknown as PromoShape)
    .filter((r) => !rosterBase.some((rb) => rb.playerId === r.player_id))
    .map((r) => {
      const base = (r.players.team_members ?? []).find((tm) => tm.left_at == null);
      return {
        playerId: r.player_id,
        firstName: r.players.first_name,
        lastName: r.players.last_name ?? '',
        dorsal: r.players.dorsal,
        positionMain: r.players.position_main,
        photoPath: r.players.photo_url,
        isPromoted: true,
        fromTeamName: base?.teams?.name ?? null,
      };
    });
  const rosterRaw = [...rosterBase, ...rosterPromoted];

  // Firmar las fotos (bucket privado player-photos) en lote.
  const photoPaths = rosterRaw
    .map((r) => r.photoPath)
    .filter((p): p is string => p != null);
  const signed = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from('player-photos')
      .createSignedUrls(photoPaths, PHOTO_TTL_SECONDS);
    for (const s of signedList ?? []) {
      if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl);
    }
  }
  const roster: RosterPlayer[] = rosterRaw.map((r) => ({
    playerId: r.playerId,
    firstName: r.firstName,
    lastName: r.lastName,
    dorsal: r.dorsal,
    positionMain: r.positionMain,
    photoUrl: r.photoPath ? (signed.get(r.photoPath) ?? null) : null,
    isPromoted: r.isPromoted,
    fromTeamName: r.fromTeamName,
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

  // Bug BB — sin alineación previa: auto-crear el borrador ("Plan A" + primera
  // formación de la modalidad) y sembrar el banquillo con los convocados, para
  // abrir el editor directamente (sin prompt intermedio).
  if (lineups.length === 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const draft = defaultLineupDraft(event.teams.format);
      const { data: created } = await supabase
        .from('lineups')
        .insert({
          event_id: eventId,
          name: draft.name,
          formation_code: draft.formationCode,
          created_by: user.id,
        })
        .select('id, name, formation_code, is_official, visibility')
        .maybeSingle();
      if (created) {
        const createdId = created.id as string;
        const calledUp = roster
          .filter((r) => !discardedSet.has(r.playerId))
          .map((r) => r.playerId);
        if (calledUp.length > 0) {
          await supabase.from('lineup_positions').insert(
            calledUp.map((pid) => ({
              lineup_id: createdId,
              player_id: pid,
              location: 'bench' as const,
            })),
          );
        }
        lineups.push({
          id: createdId,
          name: created.name as string,
          formationCode: created.formation_code as string,
          isOfficial: created.is_official as boolean,
          visibility: created.visibility as 'staff' | 'team',
        });
      }
    }
  }

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
      .select('player_id, location, position_code, x_pct, y_pct')
      .eq('lineup_id', selected.id);
    type PosShape = {
      player_id: string;
      location: LineupLocation;
      position_code: string | null;
      x_pct: number | string | null;
      y_pct: number | string | null;
    };
    positions = (posRows ?? [])
      .map((p) => p as unknown as PosShape)
      // Defensa: nunca mostrar a un descartado aunque quedara una fila vieja.
      .filter((p) => !discardedSet.has(p.player_id))
      .map((p) => ({
        playerId: p.player_id,
        location: p.location,
        positionCode: p.position_code,
        xPct: p.x_pct == null ? null : Number(p.x_pct),
        yPct: p.y_pct == null ? null : Number(p.y_pct),
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

  // F6.10 — plantillas del coach para la modalidad del equipo (selector "Mis
  // formaciones"). La RLS ya limita a las propias (+ admin/coord); filtramos
  // por owner para que solo aparezcan las del usuario actual.
  let coachFormations: CoachFormation[] = [];
  {
    const {
      data: { user: cfUser },
    } = await supabase.auth.getUser();
    if (cfUser) {
      const { data: cfRows } = await supabase
        .from('coach_formations')
        .select('id, name, format, positions')
        .eq('owner_profile_id', cfUser.id)
        .eq('format', event.teams.format)
        .order('name', { ascending: true });
      coachFormations = (cfRows ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        format: r.format as TeamFormat,
        positions: (r.positions as unknown as CoachFormationPosition[]) ?? [],
      }));
    }
  }

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
      categorySeason: event.teams.season,
      format: event.teams.format,
    },
    roster,
    discarded,
    lineups,
    selectedLineupId: selected?.id ?? null,
    positions,
    tacticalNotes,
    plannedSubs,
    coachFormations,
  };
}
