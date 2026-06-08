/**
 * F8.3 — Carga de la valoración de un ENTRENAMIENTO (flujo ligero, spec 8.0 §3.6).
 *
 * A diferencia del partido (8.2), el entreno NO tiene `match_state` ni ciclo
 * (finalizar/cerrar/reabrir): se valora directamente desde la página del evento
 * (/asistencia/[eventId]). Misma tabla `evaluations` con `event_type='training'`
 * y `rating` OPCIONAL (D8).
 *
 * Permiso autoritativo vía RPC `user_can_record_match` (mismo helper que la RLS
 * de evaluations); no mira el tipo de evento, así que vale también para entrenos.
 *
 * La lista de jugadores a valorar = ASISTENTES (training_attendance con bucket
 * present/partial) ∪ jugadores ya valorados. La asistencia se muestra como
 * CONTEXTO en solo lectura (no hay match_player_stats en entrenos).
 */

import {
  type AttendanceCode,
  bucketOf,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type TrainingEvalEvaluation = {
  rating: number | null;
  comment: string | null;
  isMvp: boolean;
};

export type TrainingEvalPlayer = {
  playerId: string;
  firstName: string;
  lastName: string | null;
  dorsal: number | null;
  /** Código de asistencia a ESTE entreno (contexto). null si valorado sin marca. */
  attendanceCode: AttendanceCode | null;
  /** null si aún no se ha valorado. */
  evaluation: TrainingEvalEvaluation | null;
};

export type TrainingEvalData = {
  event: {
    id: string;
    title: string;
    teamName: string;
    startsAt: string;
  };
  players: TrainingEvalPlayer[];
};

export async function loadTrainingEvaluation(
  clubId: string,
  eventId: string,
): Promise<TrainingEvalData | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: ev } = await supabase
    .from('events')
    .select('id, club_id, type, title, starts_at, team_id, teams!inner(name)')
    .eq('id', eventId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (!ev) return null;
  // Esta ruta es exclusiva de entrenamientos.
  if (ev.type !== 'training') return null;
  if (ev.team_id == null) return null;

  type EventShape = {
    id: string;
    title: string;
    starts_at: string;
    teams: { name: string };
  };
  const event = ev as unknown as EventShape;

  // Permiso autoritativo (mismo helper que la RLS de evaluations / F7.1).
  const { data: canRecord } = await supabase.rpc('user_can_record_match', {
    p_event_id: eventId,
  });
  if (canRecord !== true) return null;

  // Asistencia a este entreno (contexto + define los asistentes).
  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('player_id, code')
    .eq('event_id', eventId);
  const codeByPlayer = new Map<string, AttendanceCode>();
  const attendeeIds = new Set<string>();
  for (const r of attRows ?? []) {
    const code = r.code as AttendanceCode;
    codeByPlayer.set(r.player_id as string, code);
    const bucket = bucketOf(code);
    if (bucket === 'present' || bucket === 'partial') {
      attendeeIds.add(r.player_id as string);
    }
  }

  // Valoraciones ya guardadas.
  const { data: evalRows } = await supabase
    .from('evaluations')
    .select('player_id, rating, comment, is_mvp')
    .eq('event_id', eventId);
  const evalByPlayer = new Map<string, TrainingEvalEvaluation>();
  for (const r of evalRows ?? []) {
    evalByPlayer.set(r.player_id as string, {
      rating: (r.rating as number | null) ?? null,
      comment: (r.comment as string | null) ?? null,
      isMvp: (r.is_mvp as boolean) ?? false,
    });
  }

  // Lista = asistentes (present/partial) ∪ ya valorados.
  const playerIds = new Set<string>([...attendeeIds, ...evalByPlayer.keys()]);
  let players: TrainingEvalPlayer[] = [];
  if (playerIds.size > 0) {
    const { data: playerRows } = await supabase
      .from('players')
      .select('id, first_name, last_name, dorsal')
      .in('id', [...playerIds]);
    players = (playerRows ?? []).map((p) => ({
      playerId: p.id as string,
      firstName: p.first_name as string,
      lastName: (p.last_name as string | null) ?? null,
      dorsal: (p.dorsal as number | null) ?? null,
      attendanceCode: codeByPlayer.get(p.id as string) ?? null,
      evaluation: evalByPlayer.get(p.id as string) ?? null,
    }));
    players.sort((a, b) => {
      const da = a.dorsal ?? 999;
      const db = b.dorsal ?? 999;
      if (da !== db) return da - db;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '', 'es', {
        sensitivity: 'base',
      });
    });
  }

  return {
    event: {
      id: event.id,
      title: event.title,
      teamName: event.teams.name,
      startsAt: event.starts_at,
    },
    players,
  };
}
