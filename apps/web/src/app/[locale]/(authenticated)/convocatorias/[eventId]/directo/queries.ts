/**
 * F7.2 — Carga de la pantalla de toma de datos en directo del partido.
 *
 * Permission gate autoritativo vía RPC `user_can_record_match` (mismo helper SQL
 * que la RLS de F7.1): cuerpo técnico del equipo (principal o ayudante) + admin/
 * coord. Admite eventos `match` Y `friendly` (decisión spec §5.2).
 *
 * Esta subfase (7.2) es SOLO el armazón de la pantalla: no registra eventos. Para
 * pintar el campo se muestra el ONCE de la alineación oficial (si existe) como
 * estado inicial visible. La toma de datos real (drag de eventos, cronómetro
 * avanzado, congelar el once) llega en 7.3+. Las fotos del bucket privado se
 * firman aquí (TTL corto) igual que en el editor de alineación.
 */

import {
  createSupabaseServerClient,
  defaultLineupDraft,
  getFormation,
  type ClockPeriod,
  type LivePositions,
  type PeriodKind,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const PHOTO_TTL_SECONDS = 3600;

/** Evento propio ya registrado, para la lista de "últimos eventos" (F7.3/7.4). */
export type LiveMatchEvent = {
  id: string;
  type:
    | 'goal'
    | 'assist'
    | 'yellow_card'
    | 'red_card'
    | 'corner'
    | 'foul'
    | 'offside'
    | 'shot';
  /** null en eventos sobre el campo (7.4): se ubican por coordenadas, sin jugador. */
  playerId: string | null;
  playerLabel: string;
  dorsal: number | null;
  clockSeconds: number;
  displayMinute: number | null;
  period: PeriodKind;
};

export type LiveFieldPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
  photoUrl: string | null;
  positionCode: string | null;
  xPct: number | null;
  yPct: number | null;
};

/** Suplente de la alineación oficial (banquillo, F7.5). */
export type LiveBenchPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
  photoUrl: string | null;
};

/**
 * Evento del RIVAL ya registrado (F7.6). El rival no tiene roster (§3.4): se
 * identifica por dorsal + nota libre. `side='rival'`.
 */
export type LiveRivalEvent = {
  id: string;
  type:
    | 'goal'
    | 'yellow_card'
    | 'red_card'
    | 'foul'
    | 'corner'
    | 'offside'
    | 'shot';
  dorsal: number | null;
  note: string | null;
  clockSeconds: number;
  displayMinute: number | null;
  period: PeriodKind;
};

/** Sustitución registrada (F7.5): SALE `out`, ENTRA `in`, con nombres. */
export type LiveSubstitution = {
  id: string;
  outId: string;
  inId: string;
  outLabel: string;
  inLabel: string;
  clockSeconds: number;
  displayMinute: number | null;
  period: PeriodKind;
};

export type MatchLiveData = {
  event: {
    id: string;
    teamId: string;
    title: string;
    type: 'match' | 'friendly';
    opponentName: string | null;
    startsAt: string;
    teamName: string;
    teamColor: string;
    categoryName: string;
    categorySeason: string;
    format: TeamFormat;
    /**
     * Duración SUGERIDA de cada tiempo (min), de la categoría del equipo
     * (F4.9). El reloj no la impone (el operador prolonga libremente), solo la
     * muestra como referencia (§3.2/§6). Depende de la categoría: Alevín 30,
     * juvenil/amateur 45… nunca un valor fijo.
     */
    halfDurationMinutes: number;
  };
  /** Formación del once mostrado (oficial si existe; si no, default de la modalidad). */
  formationCode: string;
  /** Once titular para pintar el campo (vacío si no hay alineación oficial todavía). */
  fieldPlayers: LiveFieldPlayer[];
  /** ¿Existe alineación oficial? (UI muestra aviso si no.) */
  hasOfficialLineup: boolean;
  /** Estado de la sesión de captura (F7.7). 'not_started' si aún no hay fila. */
  matchStatus: 'not_started' | 'live' | 'closed';
  /**
   * Periodos del reloj (F7.7, §3.2/§6). El cliente reconstruye el cronómetro a
   * partir de estas filas → sobrevive a recargas. Vacío hasta "Iniciar partido".
   */
  periods: ClockPeriod[];
  /**
   * Eventos propios sobre jugador ya registrados (F7.3), más recientes primero.
   * Solo lectura aquí (editar/borrar es la línea de tiempo, 7.9).
   */
  recentEvents: LiveMatchEvent[];
  /** Suplentes de la alineación oficial (banquillo, F7.5). */
  benchPlayers: LiveBenchPlayer[];
  /** Sustituciones registradas (F7.5), orden cronológico (clock_seconds asc). */
  substitutions: LiveSubstitution[];
  /** Jugadores marcados AUSENTES para este partido (F7.5, match_absences). */
  absentIds: string[];
  /** Eventos del RIVAL (F7.6), más recientes primero. */
  rivalEvents: LiveRivalEvent[];
  /**
   * F7.6 — cambios corridos: ¿puede un jugador sustituido VOLVER a entrar? Flag
   * de la categoría (`categories.allow_reentry`). Lo lee `deriveSquad`.
   */
  allowReentry: boolean;
  /**
   * F7.6b — formación EN JUEGO ahora (null → la oficial de F6). Se cambia en
   * directo y persiste en match_state.
   */
  liveFormationCode: string | null;
  /**
   * F7.6b — posiciones vivas por jugador (override sobre el slot oficial), de
   * mover jugadores / cambiar formación. Persiste e hidrata.
   */
  livePositions: LivePositions;
};

export async function loadMatchLive(
  clubId: string,
  eventId: string,
): Promise<MatchLiveData | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, title, opponent_name, starts_at,
       teams!inner(name, color, format, categories!inner(name, season, half_duration_minutes, allow_reentry))`,
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  // F7 admite partido y amistoso (no entrenamientos ni otros).
  if (ev.type !== 'match' && ev.type !== 'friendly') return null;
  if (ev.team_id == null) return null;

  type EventShape = {
    id: string;
    team_id: string;
    type: 'match' | 'friendly';
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: {
      name: string;
      color: string;
      format: TeamFormat;
      categories: {
        name: string;
        season: string;
        half_duration_minutes: number | null;
        allow_reentry: boolean;
      };
    };
  };
  const event = ev as unknown as EventShape;

  // Permiso autoritativo (mismo helper que la RLS de F7.1).
  const { data: canRecord } = await supabase.rpc('user_can_record_match', {
    p_event_id: eventId,
  });
  if (canRecord !== true) return null;

  // Alineación oficial → once titular para pintar el campo.
  const { data: officialRow } = await supabase
    .from('lineups')
    .select('id, formation_code')
    .eq('event_id', eventId)
    .eq('is_official', true)
    .maybeSingle();

  let formationCode = officialRow?.formation_code ?? null;
  let fieldPlayers: LiveFieldPlayer[] = [];
  let benchPlayers: LiveBenchPlayer[] = [];

  if (officialRow) {
    const lineupId = officialRow.id as string;
    // F7.5: cargamos campo Y banquillo (location in field/bench) de una vez.
    const { data: posRows } = await supabase
      .from('lineup_positions')
      .select(
        `player_id, position_code, x_pct, y_pct, location,
         players!inner(first_name, last_name, dorsal, photo_url)`,
      )
      .eq('lineup_id', lineupId)
      .in('location', ['field', 'bench']);

    type PosShape = {
      player_id: string;
      position_code: string | null;
      x_pct: number | string | null;
      y_pct: number | string | null;
      location: 'field' | 'bench';
      players: {
        first_name: string;
        last_name: string | null;
        dorsal: number | null;
        photo_url: string | null;
      };
    };
    const raw = (posRows ?? []).map((p) => p as unknown as PosShape);

    // Firmar fotos (bucket privado) en lote (campo + banquillo).
    const photoPaths = raw
      .map((r) => r.players.photo_url)
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

    const labelOf = (r: PosShape) =>
      r.players.last_name || r.players.first_name || r.player_id.slice(0, 4);
    const photoOf = (r: PosShape) =>
      r.players.photo_url ? (signed.get(r.players.photo_url) ?? null) : null;

    fieldPlayers = raw
      .filter((r) => r.location === 'field')
      .map((r) => ({
        playerId: r.player_id,
        label: labelOf(r),
        dorsal: r.players.dorsal,
        photoUrl: photoOf(r),
        positionCode: r.position_code,
        xPct: r.x_pct == null ? null : Number(r.x_pct),
        yPct: r.y_pct == null ? null : Number(r.y_pct),
      }));

    benchPlayers = raw
      .filter((r) => r.location === 'bench')
      .map((r) => ({
        playerId: r.player_id,
        label: labelOf(r),
        dorsal: r.players.dorsal,
        photoUrl: photoOf(r),
      }))
      .sort((a, b) => (a.dorsal ?? 99) - (b.dorsal ?? 99));
  }

  // Sin formación oficial: default de la modalidad (campo vacío pero coherente).
  if (!formationCode || !getFormation(formationCode)) {
    formationCode = defaultLineupDraft(event.teams.format).formationCode;
  }

  // Estado de la sesión + reloj (F7.7). El cliente reconstruye el cronómetro
  // desde `periods` (recuperable tras recarga, §6).
  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status, live_formation_code, live_positions')
    .eq('event_id', eventId)
    .maybeSingle();
  const matchStatus =
    (stateRow?.status as 'not_started' | 'live' | 'closed' | undefined) ??
    'not_started';
  // F7.6b — estado táctico vivo (formación + posiciones movidas), para hidratar
  // el campo tras recargar/volver. Override sobre el slot oficial.
  const liveFormationCode = (stateRow?.live_formation_code as string | null) ?? null;
  const livePositions = (stateRow?.live_positions as LivePositions | null) ?? {};

  const { data: periodRows } = await supabase
    .from('match_periods')
    .select(
      'period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended',
    )
    .eq('event_id', eventId)
    .order('ordinal', { ascending: true });
  const periods: ClockPeriod[] = (periodRows ?? []).map((r) => ({
    period: r.period as PeriodKind,
    ordinal: r.ordinal as number,
    baseOffsetSeconds: r.base_offset_seconds as number,
    accumulatedSeconds: r.accumulated_seconds as number,
    running: r.running as boolean,
    lastStartedAt: (r.last_started_at as string | null) ?? null,
    ended: r.ended as boolean,
  }));

  // Eventos propios ya registrados (F7.3 sobre jugador + F7.4 sobre campo),
  // recientes primero. Excluye 'substitution' (es 7.5, otra UI).
  const DISPLAY_EVENT_TYPES = [
    'goal',
    'assist',
    'yellow_card',
    'red_card',
    'corner',
    'foul',
    'offside',
    'shot',
  ];
  // OJO: match_events tiene DOS FKs a players (player_id y related_player_id),
  // así que el embed `players(...)` es AMBIGUO y PostgREST lo rechaza (PGRST201)
  // → data null → lista vacía. Hay que desambiguar por el FK de player_id.
  const { data: eventRows, error: eventRowsError } = await supabase
    .from('match_events')
    .select(
      `id, type, player_id, clock_seconds, display_minute, period,
       players!match_events_player_id_fkey(first_name, last_name, dorsal)`,
    )
    .eq('event_id', eventId)
    .eq('side', 'own')
    .in('type', DISPLAY_EVENT_TYPES)
    .order('clock_seconds', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);
  // No tragar el fallo en silencio: si la carga de eventos falla, que quede en
  // los logs del servidor (antes esto enmascaraba el embed ambiguo → lista vacía).
  if (eventRowsError) {
    console.error('[directo] error cargando match_events:', eventRowsError);
  }

  type EventRowShape = {
    id: string;
    type: LiveMatchEvent['type'];
    player_id: string | null;
    clock_seconds: number;
    display_minute: number | null;
    period: PeriodKind;
    players: {
      first_name: string;
      last_name: string | null;
      dorsal: number | null;
    } | null;
  };
  const recentEvents: LiveMatchEvent[] = (eventRows ?? []).map((row) => {
    const r = row as unknown as EventRowShape;
    const label =
      r.players?.last_name ||
      r.players?.first_name ||
      (r.player_id ? r.player_id.slice(0, 4) : '—');
    return {
      id: r.id,
      type: r.type,
      playerId: r.player_id,
      playerLabel: label,
      dorsal: r.players?.dorsal ?? null,
      clockSeconds: r.clock_seconds,
      displayMinute: r.display_minute,
      period: r.period,
    };
  });

  // Sustituciones (F7.5): orden cronológico (asc) para derivar campo/banquillo.
  // Embed desambiguado de los DOS jugadores (sale=player_id, entra=related).
  const { data: subRows, error: subErr } = await supabase
    .from('match_events')
    .select(
      `id, player_id, related_player_id, clock_seconds, display_minute, period,
       out:players!match_events_player_id_fkey(first_name, last_name, dorsal),
       in:players!match_events_related_player_id_fkey(first_name, last_name, dorsal)`,
    )
    .eq('event_id', eventId)
    .eq('side', 'own')
    .eq('type', 'substitution')
    .order('clock_seconds', { ascending: true });
  if (subErr) console.error('[directo] error cargando sustituciones:', subErr);

  type PlayerMini = { first_name: string; last_name: string | null; dorsal: number | null } | null;
  type SubRowShape = {
    id: string;
    player_id: string | null;
    related_player_id: string | null;
    clock_seconds: number;
    display_minute: number | null;
    period: PeriodKind;
    out: PlayerMini;
    in: PlayerMini;
  };
  const nameOf = (p: PlayerMini, fallback: string | null) =>
    p?.last_name || p?.first_name || (fallback ? fallback.slice(0, 4) : '—');
  const substitutions: LiveSubstitution[] = (subRows ?? [])
    .map((row) => row as unknown as SubRowShape)
    .filter((r) => r.player_id && r.related_player_id)
    .map((r) => ({
      id: r.id,
      outId: r.player_id as string,
      inId: r.related_player_id as string,
      outLabel: nameOf(r.out, r.player_id),
      inLabel: nameOf(r.in, r.related_player_id),
      clockSeconds: r.clock_seconds,
      displayMinute: r.display_minute,
      period: r.period,
    }));

  // Ausencias (F7.5, match_absences).
  const { data: absRows } = await supabase
    .from('match_absences')
    .select('player_id')
    .eq('event_id', eventId);
  const absentIds = (absRows ?? []).map((r) => r.player_id as string);

  // Eventos del RIVAL (F7.6): por dorsal + nota libre (metadata.note), recientes
  // primero. Sin embed de players (el rival no tiene roster, §3.4).
  const RIVAL_DISPLAY_TYPES = [
    'goal',
    'yellow_card',
    'red_card',
    'foul',
    'corner',
    'offside',
    'shot',
  ];
  const { data: rivalRows, error: rivalErr } = await supabase
    .from('match_events')
    .select('id, type, rival_dorsal, metadata, clock_seconds, display_minute, period')
    .eq('event_id', eventId)
    .eq('side', 'rival')
    .in('type', RIVAL_DISPLAY_TYPES)
    .order('clock_seconds', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(60);
  if (rivalErr) console.error('[directo] error cargando eventos rival:', rivalErr);

  type RivalRowShape = {
    id: string;
    type: LiveRivalEvent['type'];
    rival_dorsal: number | null;
    metadata: { note?: string } | null;
    clock_seconds: number;
    display_minute: number | null;
    period: PeriodKind;
  };
  const rivalEvents: LiveRivalEvent[] = (rivalRows ?? []).map((row) => {
    const r = row as unknown as RivalRowShape;
    return {
      id: r.id,
      type: r.type,
      dorsal: r.rival_dorsal,
      note: r.metadata?.note ?? null,
      clockSeconds: r.clock_seconds,
      displayMinute: r.display_minute,
      period: r.period,
    };
  });

  return {
    event: {
      id: event.id,
      teamId: event.team_id,
      title: event.title,
      type: event.type,
      opponentName: event.opponent_name,
      startsAt: event.starts_at,
      teamName: event.teams.name,
      teamColor: event.teams.color,
      categoryName: event.teams.categories.name,
      categorySeason: event.teams.categories.season,
      format: event.teams.format,
      // La columna es NOT NULL default 45; el ?? es solo defensivo.
      halfDurationMinutes: event.teams.categories.half_duration_minutes ?? 45,
    },
    formationCode,
    fieldPlayers,
    hasOfficialLineup: officialRow != null,
    matchStatus,
    periods,
    recentEvents,
    benchPlayers,
    substitutions,
    absentIds,
    rivalEvents,
    allowReentry: event.teams.categories.allow_reentry,
    liveFormationCode,
    livePositions,
  };
}
