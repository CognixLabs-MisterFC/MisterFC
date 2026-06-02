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
  type PeriodKind,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const PHOTO_TTL_SECONDS = 3600;

export type LiveFieldPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
  photoUrl: string | null;
  positionCode: string | null;
  xPct: number | null;
  yPct: number | null;
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
       teams!inner(name, color, format, categories!inner(name, season))`,
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
      categories: { name: string; season: string };
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

  if (officialRow) {
    const lineupId = officialRow.id as string;
    const { data: posRows } = await supabase
      .from('lineup_positions')
      .select(
        `player_id, position_code, x_pct, y_pct,
         players!inner(first_name, last_name, dorsal, photo_url)`,
      )
      .eq('lineup_id', lineupId)
      .eq('location', 'field');

    type PosShape = {
      player_id: string;
      position_code: string | null;
      x_pct: number | string | null;
      y_pct: number | string | null;
      players: {
        first_name: string;
        last_name: string | null;
        dorsal: number | null;
        photo_url: string | null;
      };
    };
    const raw = (posRows ?? []).map((p) => p as unknown as PosShape);

    // Firmar fotos (bucket privado) en lote.
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

    fieldPlayers = raw.map((r) => ({
      playerId: r.player_id,
      label: r.players.last_name || r.players.first_name || r.player_id.slice(0, 4),
      dorsal: r.players.dorsal,
      photoUrl: r.players.photo_url
        ? (signed.get(r.players.photo_url) ?? null)
        : null,
      positionCode: r.position_code,
      xPct: r.x_pct == null ? null : Number(r.x_pct),
      yPct: r.y_pct == null ? null : Number(r.y_pct),
    }));
  }

  // Sin formación oficial: default de la modalidad (campo vacío pero coherente).
  if (!formationCode || !getFormation(formationCode)) {
    formationCode = defaultLineupDraft(event.teams.format).formationCode;
  }

  // Estado de la sesión + reloj (F7.7). El cliente reconstruye el cronómetro
  // desde `periods` (recuperable tras recarga, §6).
  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status')
    .eq('event_id', eventId)
    .maybeSingle();
  const matchStatus =
    (stateRow?.status as 'not_started' | 'live' | 'closed' | undefined) ??
    'not_started';

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
    },
    formationCode,
    fieldPlayers,
    hasOfficialLineup: officialRow != null,
    matchStatus,
    periods,
  };
}
