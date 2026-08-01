'use server';

import { revalidatePath } from 'next/cache';
import {
  clearAttendanceFromClient,
  createSupabaseServerClient,
  markAttendanceBulkSchema,
  markAttendanceFromClient,
  type AttendanceCode,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ─────────────────────────────────────────────────────────────────────────────
// markAttendance (single, F4.2)
// ─────────────────────────────────────────────────────────────────────────────

export type MarkAttendanceState = {
  error?:
    | 'event_invalid'
    | 'player_invalid'
    | 'code_invalid'
    | 'notes_too_long'
    | 'event_not_training'
    | 'event_in_future'
    | 'player_not_in_team_at_event'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

function mapErr(code: string | undefined): MarkAttendanceState['error'] {
  const known = [
    'event_invalid',
    'player_invalid',
    'code_invalid',
    'notes_too_long',
  ] as const;
  if (code && (known as readonly string[]).includes(code)) {
    return code as MarkAttendanceState['error'];
  }
  return 'generic';
}

function mapPgErr(
  message: string | undefined,
  pgcode: string | undefined
): MarkAttendanceState['error'] {
  if (pgcode === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_training')) return 'event_not_training';
  if (message.includes('event_in_future')) return 'event_in_future';
  if (message.includes('player_not_in_team_at_event'))
    return 'player_not_in_team_at_event';
  return 'generic';
}

/**
 * Marca o actualiza la asistencia de un jugador a un entrenamiento. Upsert
 * incremental por (event_id, player_id). O2-7a: la lógica (validación + SELECT →
 * UPDATE|INSERT + mapeo de errores) se extrajo a core `markAttendanceFromClient`
 * (compartida con la app nativa); aquí solo se resuelve el cliente y se revalida.
 */
export async function markAttendance(
  input: {
    event_id: string;
    player_id: string;
    code: AttendanceCode;
    notes?: string | null;
  }
): Promise<MarkAttendanceState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await markAttendanceFromClient(supabase, input);
  if (!res.ok) return { error: res.error };

  revalidatePath('/[locale]/(authenticated)/asistencia', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/asistencia/${input.event_id}`,
    'page'
  );
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// markAttendanceBulk (F4.2 — marcado masivo del equipo)
// ─────────────────────────────────────────────────────────────────────────────

export type MarkAttendanceBulkState = {
  error?: MarkAttendanceState['error'] | 'entries_required' | 'entries_too_many';
  success?: boolean;
  affected?: number;
};

export async function markAttendanceBulk(
  input: {
    event_id: string;
    entries: Array<{
      player_id: string;
      code: AttendanceCode;
      notes?: string | null;
    }>;
  }
): Promise<MarkAttendanceBulkState> {
  const parsed = markAttendanceBulkSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    if (msg === 'entries_required' || msg === 'entries_too_many') {
      return { error: msg };
    }
    return { error: mapErr(msg) };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  // Recogemos filas existentes en un solo viaje y dividimos en
  // UPDATEs e INSERTs.
  const playerIds = parsed.data.entries.map((e) => e.player_id);
  const { data: existingRows } = await supabase
    .from('training_attendance')
    .select('id, player_id')
    .eq('event_id', parsed.data.event_id)
    .in('player_id', playerIds);

  type ExistingRow = { id: string; player_id: string };
  const existingMap = new Map<string, string>();
  for (const r of (existingRows ?? []) as ExistingRow[]) {
    existingMap.set(r.player_id, r.id);
  }

  let affected = 0;

  // UPDATEs primero.
  for (const e of parsed.data.entries) {
    const id = existingMap.get(e.player_id);
    if (!id) continue;
    const { error } = await supabase
      .from('training_attendance')
      .update({ code: e.code, notes: e.notes })
      .eq('id', id);
    if (error) return { error: mapPgErr(error.message, error.code) };
    affected++;
  }

  // INSERTs después.
  const toInsert = parsed.data.entries
    .filter((e) => !existingMap.has(e.player_id))
    .map((e) => ({
      event_id: parsed.data.event_id,
      player_id: e.player_id,
      code: e.code,
      notes: e.notes,
      recorded_by: user.id,
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from('training_attendance')
      .insert(toInsert);
    if (error) return { error: mapPgErr(error.message, error.code) };
    affected += toInsert.length;
  }

  revalidatePath('/[locale]/(authenticated)/asistencia', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/asistencia/${parsed.data.event_id}`,
    'page'
  );
  return { success: true, affected };
}

// ─────────────────────────────────────────────────────────────────────────────
// clearAttendance — borra una fila concreta (para "deshacer" en la UI)
// ─────────────────────────────────────────────────────────────────────────────

export type ClearAttendanceState = {
  error?: 'forbidden' | 'generic';
  success?: boolean;
};

export async function clearAttendance(
  eventId: string,
  playerId: string
): Promise<ClearAttendanceState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // O2-7a — borrado extraído a core `clearAttendanceFromClient`.
  const res = await clearAttendanceFromClient(supabase, eventId, playerId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/[locale]/(authenticated)/asistencia', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/asistencia/${eventId}`,
    'page'
  );
  return { success: true };
}
