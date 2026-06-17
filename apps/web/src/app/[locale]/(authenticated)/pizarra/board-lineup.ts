/**
 * F11B.2 — Carga READ-ONLY del once real para la pizarra táctica.
 *
 * A diferencia de `loadLineupEditor` (F6), aquí NO se crea ningún borrador ni se
 * cargan notas/cambios/descartes: solo se LEE la alineación OFICIAL del evento
 * (o la más reciente si no hay oficial) y sus jugadores DE CAMPO, con las
 * coordenadas ya resueltas (coords propias → slot de la formación → centro), de
 * modo que `<MatchFieldEditor mode="readonly">` los pinte sin necesitar la
 * formación ni i18n de slots. El gate es el mismo helper que la RLS
 * (`user_can_manage_lineup`). Efímero: la pizarra no escribe nada.
 *
 * Reusa los patrones de lectura de F6 (roster a fecha + fotos firmadas del
 * bucket privado) y los helpers de formación de `@misterfc/core` — no duplica el
 * editor de alineación.
 */

import {
  createSupabaseServerClient,
  getFormation,
  coachFormationToFormation,
  type CoachFormationPosition,
  type Formation,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import type { FieldEditorPlayer } from '@/components/match/match-field-editor';

const PHOTO_TTL_SECONDS = 3600;

export type BoardLineup = {
  event: {
    id: string;
    title: string;
    opponentName: string | null;
    teamName: string;
    format: TeamFormat;
  };
  formationCode: string;
  /** Jugadores de CAMPO con coordenadas ya resueltas (0–100). */
  players: FieldEditorPlayer[];
};

/** Etiqueta corta para el chip: "N. Apellido" (o el nombre si no hay apellido). */
function shortLabel(firstName: string, lastName: string): string {
  const f = firstName.trim();
  const l = lastName.trim();
  if (!l) return f;
  return f ? `${f.charAt(0)}. ${l}` : l;
}

export async function loadBoardLineup(
  clubId: string,
  eventId: string,
): Promise<BoardLineup | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Evento + modalidad del equipo.
  const { data: ev } = await supabase
    .from('events')
    .select('id, club_id, team_id, title, opponent_name, starts_at, teams!inner(name, format)')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev || (ev.club_id as string) !== clubId || ev.team_id == null) return null;
  const event = ev as unknown as {
    id: string;
    team_id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: { name: string; format: TeamFormat };
  };

  // Permiso autoritativo (mismo helper que la RLS).
  const { data: canManage } = await supabase.rpc('user_can_manage_lineup', { p_event_id: eventId });
  if (canManage !== true) return null;

  // Alineación OFICIAL (o la más reciente). SIN crear nada.
  const { data: lineupRows } = await supabase
    .from('lineups')
    .select('id, formation_code, is_official, created_at')
    .eq('event_id', eventId)
    .order('is_official', { ascending: false })
    .order('created_at', { ascending: true });
  const lineup = (lineupRows ?? [])[0] as
    | { id: string; formation_code: string }
    | undefined;
  if (!lineup) return null;
  const formationCode = lineup.formation_code as string;

  // Posiciones de CAMPO de esa alineación.
  const { data: posRows } = await supabase
    .from('lineup_positions')
    .select('player_id, location, position_code, x_pct, y_pct')
    .eq('lineup_id', lineup.id)
    .eq('location', 'field');
  const positions = (posRows ?? []).map((p) => ({
    playerId: p.player_id as string,
    positionCode: (p.position_code as string | null) ?? null,
    xPct: p.x_pct == null ? null : Number(p.x_pct),
    yPct: p.y_pct == null ? null : Number(p.y_pct),
  }));
  if (positions.length === 0) {
    return {
      event: {
        id: event.id,
        title: event.title,
        opponentName: event.opponent_name,
        teamName: event.teams.name,
        format: event.teams.format,
      },
      formationCode,
      players: [],
    };
  }

  // Datos de los jugadores de campo (nombre, dorsal, foto).
  const ids = positions.map((p) => p.playerId);
  const { data: playerRows } = await supabase
    .from('players')
    .select('id, first_name, last_name, dorsal, photo_url')
    .in('id', ids);
  const byId = new Map(
    (playerRows ?? []).map((r) => [
      r.id as string,
      {
        firstName: r.first_name as string,
        lastName: (r.last_name as string | null) ?? '',
        dorsal: (r.dorsal as number | null) ?? null,
        photoPath: (r.photo_url as string | null) ?? null,
      },
    ]),
  );

  // Firmar fotos del bucket privado en lote.
  const photoPaths = [...byId.values()].map((v) => v.photoPath).filter((p): p is string => p != null);
  const signed = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from('player-photos')
      .createSignedUrls(photoPaths, PHOTO_TTL_SECONDS);
    for (const s of signedList ?? []) {
      if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl);
    }
  }

  // Slots de la formación (catálogo o plantilla del coach) para resolver coords
  // de los jugadores sin coordenadas propias.
  let formation: Formation | undefined = getFormation(formationCode);
  if (!formation) {
    const { data: cf } = await supabase
      .from('coach_formations')
      .select('id, name, format, positions')
      .eq('id', formationCode)
      .maybeSingle();
    if (cf) {
      formation = coachFormationToFormation({
        id: cf.id as string,
        name: cf.name as string,
        format: cf.format as TeamFormat,
        positions: (cf.positions as unknown as CoachFormationPosition[]) ?? [],
      });
    }
  }
  const slotByCode = new Map((formation?.slots ?? []).map((s) => [s.code, { x: s.xPct, y: s.yPct }]));

  const players: FieldEditorPlayer[] = positions.map((p) => {
    const info = byId.get(p.playerId);
    const slot = p.positionCode ? slotByCode.get(p.positionCode) : undefined;
    const x = p.xPct ?? slot?.x ?? 50;
    const y = p.yPct ?? slot?.y ?? 50;
    return {
      playerId: p.playerId,
      label: info ? shortLabel(info.firstName, info.lastName) : '',
      dorsal: info?.dorsal ?? null,
      photoUrl: info?.photoPath ? (signed.get(info.photoPath) ?? null) : null,
      positionCode: p.positionCode,
      xPct: x,
      yPct: y,
    };
  });

  return {
    event: {
      id: event.id,
      title: event.title,
      opponentName: event.opponent_name,
      teamName: event.teams.name,
      format: event.teams.format,
    },
    formationCode,
    players,
  };
}
