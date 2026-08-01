/**
 * O2-7a — ESCRITURA de asistencia (pasar lista), framework-agnóstica. Extraído de
 * `apps/web/.../asistencia/actions.ts` (`markAttendance` + `clearAttendance`). La
 * web pasa a delegar (misma lógica → comportamiento idéntico) y añade su
 * `revalidatePath`; la app nativa la llama directamente detrás del write-guard.
 *
 * INCREMENTAL por (event_id, player_id): cada marca es UN upsert manual
 * (SELECT → UPDATE | INSERT), NO un batch. Así, sin cola de sync, si se corta la
 * red a media lista lo ya marcado queda guardado. NO se usa upsert de PostgREST:
 * traduciría a INSERT ... ON CONFLICT DO UPDATE y evaluaría la policy INSERT
 * WITH CHECK para todas las filas (lección de PR #19 con capabilities).
 *
 * El GATE (quién puede pasar lista) es server-side: la RLS/triggers rechazan la
 * escritura no autorizada → se mapea a `forbidden`/errores de trigger; el caller
 * los maneja con gracia (no crash), NO se reimplementa el permiso en cliente.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  markAttendanceSchema,
  type AttendanceCode,
} from '../schemas/attendance';
import { getCurrentUserFromClient } from '../auth/current-user';

type DbClient = SupabaseClient<Database>;

export type MarkAttendanceError =
  | 'event_invalid'
  | 'player_invalid'
  | 'code_invalid'
  | 'notes_too_long'
  | 'event_not_training'
  | 'event_in_future'
  | 'player_not_in_team_at_event'
  | 'forbidden'
  | 'generic';

export type MarkAttendanceOutcome =
  | { ok: true }
  | { ok: false; error: MarkAttendanceError };

/** Errores de validación conocidos (zod) que se propagan tal cual. */
function mapValidationErr(code: string | undefined): MarkAttendanceError {
  const known = [
    'event_invalid',
    'player_invalid',
    'code_invalid',
    'notes_too_long',
  ] as const;
  if (code && (known as readonly string[]).includes(code)) {
    return code as MarkAttendanceError;
  }
  return 'generic';
}

/** Errores de Postgres (RLS 42501 → forbidden; triggers → mensaje). */
function mapPgErr(
  message: string | undefined,
  pgcode: string | undefined,
): MarkAttendanceError {
  if (pgcode === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_training')) return 'event_not_training';
  if (message.includes('event_in_future')) return 'event_in_future';
  if (message.includes('player_not_in_team_at_event'))
    return 'player_not_in_team_at_event';
  return 'generic';
}

/**
 * Marca/actualiza la asistencia de UN jugador a un entrenamiento. Upsert manual por
 * (event_id, player_id): existe → UPDATE de code/notes; no existe → INSERT
 * (recorded_by lo fuerza el trigger a auth.uid(); el cliente envía el id de sesión
 * como placeholder que la BD sobrescribe).
 */
export async function markAttendanceFromClient(
  supabase: DbClient,
  input: {
    event_id: string;
    player_id: string;
    code: AttendanceCode;
    notes?: string | null;
  },
): Promise<MarkAttendanceOutcome> {
  const parsed = markAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: mapValidationErr(parsed.error.issues[0]?.message) };
  }

  const { data: existing } = await supabase
    .from('training_attendance')
    .select('id')
    .eq('event_id', parsed.data.event_id)
    .eq('player_id', parsed.data.player_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('training_attendance')
      .update({ code: parsed.data.code, notes: parsed.data.notes })
      .eq('id', existing.id as string);
    if (error) return { ok: false, error: mapPgErr(error.message, error.code) };
  } else {
    const user = await getCurrentUserFromClient(supabase);
    if (!user) return { ok: false, error: 'forbidden' };
    const { error } = await supabase.from('training_attendance').insert({
      event_id: parsed.data.event_id,
      player_id: parsed.data.player_id,
      code: parsed.data.code,
      notes: parsed.data.notes,
      recorded_by: user.id,
    });
    if (error) return { ok: false, error: mapPgErr(error.message, error.code) };
  }

  return { ok: true };
}

export type ClearAttendanceOutcome =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'generic' };

/** Borra la fila (event_id, player_id) — "deshacer" una marca. */
export async function clearAttendanceFromClient(
  supabase: DbClient,
  eventId: string,
  playerId: string,
): Promise<ClearAttendanceOutcome> {
  const { error } = await supabase
    .from('training_attendance')
    .delete()
    .eq('event_id', eventId)
    .eq('player_id', playerId);

  if (error) {
    if (error.code === '42501') return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'generic' };
  }
  return { ok: true };
}
