'use server';

/**
 * F8.2 — Server actions de la etapa post-partido (valoraciones del partido).
 *
 * Persistencia upsert por (event_id, player_id) contra `evaluations` (D9). La
 * autoridad la impone la RLS (`user_can_record_match`): aquí no re-chequeamos
 * rol, dejamos que la policy rechace (42501 → 'forbidden'). El trigger de la BD
 * es la red de las invariantes (rating obligatorio en partido, MVP único, no
 * fila vacía); el cliente las valida antes para no llegar a un error feo.
 *
 * "Completar valoraciones" marca match_state.post_match_done=true (cierre del
 * ciclo, §3.5). No exige tener a todos valorados (D6).
 */

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServerClient,
  upsertEvaluationSchema,
  deleteEvaluationSchema,
  setPostMatchDoneSchema,
  upsertTeamEvaluationSchema,
  deleteTeamEvaluationSchema,
  upsertPrivateNoteSchema,
  deletePrivateNoteSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type ActionResult = { success?: boolean; error?: string };

function mapErr(message: string | undefined, code: string | undefined): string {
  if (code === '42501') return 'forbidden';
  // FK de evaluation_private_notes → evaluations: la nota privada exige que el
  // jugador tenga una valoración individual previa (8.4).
  if (code === '23503') return 'needs_evaluation';
  if (!message) return 'generic';
  if (message.includes('rating_required_for_match')) return 'rating_required';
  if (message.includes('empty_evaluation')) return 'empty';
  if (message.includes('evaluations_one_mvp_per_event')) return 'mvp_taken';
  if (message.includes('player_not_in_team_at_event')) return 'invalid';
  if (message.includes('event_not_a_match')) return 'invalid';
  return 'generic';
}

function revalidate(eventId: string) {
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}/post-partido`,
    'page',
  );
  revalidatePath(`/[locale]/(authenticated)/convocatorias/${eventId}`, 'page');
}

export async function upsertEvaluation(input: unknown): Promise<ActionResult> {
  const parsed = upsertEvaluationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id, rating, comment, is_mvp } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthenticated' };

  // MVP único por evento: si este jugador pasa a MVP, desmarcamos al anterior
  // primero (la UI ya lo refleja; aquí lo garantizamos para no chocar con el
  // índice parcial si se llamara la action directamente).
  if (is_mvp) {
    const { error: clearErr } = await supabase
      .from('evaluations')
      .update({ is_mvp: false })
      .eq('event_id', event_id)
      .eq('is_mvp', true)
      .neq('player_id', player_id);
    if (clearErr) return { error: mapErr(clearErr.message, clearErr.code) };
  }

  // Upsert "a mano": UPDATE de los campos mutables; si no había fila, INSERT.
  // No usamos .upsert() porque en el camino UPDATE tocaría created_by y el
  // trigger lo bloquea como inmutable (editor ≠ creador original).
  const { data: updated, error: updErr } = await supabase
    .from('evaluations')
    .update({ rating, comment, is_mvp })
    .eq('event_id', event_id)
    .eq('player_id', player_id)
    .select('player_id');
  if (updErr) return { error: mapErr(updErr.message, updErr.code) };

  if (!updated || updated.length === 0) {
    const { error: insErr } = await supabase.from('evaluations').insert({
      event_id,
      player_id,
      // club_id/team_id/event_type/created_by los DERIVA/fuerza el trigger; los
      // pasamos para cumplir el NOT NULL antes del BEFORE trigger.
      club_id: '00000000-0000-0000-0000-000000000000',
      team_id: '00000000-0000-0000-0000-000000000000',
      event_type: 'match',
      created_by: user.id,
      rating,
      comment,
      is_mvp,
    });
    if (insErr) return { error: mapErr(insErr.message, insErr.code) };
  }

  revalidate(event_id);
  return { success: true };
}

export async function deleteEvaluation(input: unknown): Promise<ActionResult> {
  const parsed = deleteEvaluationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('evaluations')
    .delete()
    .eq('event_id', event_id)
    .eq('player_id', player_id);
  if (error) return { error: mapErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

export async function setPostMatchDone(input: unknown): Promise<ActionResult> {
  const parsed = setPostMatchDoneSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, done } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Solo tiene sentido cerrar la etapa de un partido FINALIZADO.
  const { data: stateRow } = await supabase
    .from('match_state')
    .select('status')
    .eq('event_id', event_id)
    .maybeSingle();
  if (stateRow?.status !== 'closed') return { error: 'not_closed' };

  const { error } = await supabase
    .from('match_state')
    .update({ post_match_done: done })
    .eq('event_id', event_id);
  if (error) return { error: mapErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// F8.3 — Valoración COLECTIVA del equipo (tabla team_evaluations, una por
// partido). Independiente de las valoraciones individuales: no toca `evaluations`.
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertTeamEvaluation(
  input: unknown,
): Promise<ActionResult> {
  const parsed = upsertTeamEvaluationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, rating, comment } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthenticated' };

  // Upsert "a mano": UPDATE de los mutables; si no había fila, INSERT. No usamos
  // .upsert() porque tocaría created_by (inmutable: editor ≠ creador original).
  const { data: updated, error: updErr } = await supabase
    .from('team_evaluations')
    .update({ rating, comment })
    .eq('event_id', event_id)
    .select('event_id');
  if (updErr) return { error: mapErr(updErr.message, updErr.code) };

  if (!updated || updated.length === 0) {
    const { error: insErr } = await supabase.from('team_evaluations').insert({
      event_id,
      // club_id/team_id/created_by los DERIVA/fuerza el trigger; se pasan para
      // cumplir el NOT NULL antes del BEFORE trigger.
      club_id: '00000000-0000-0000-0000-000000000000',
      team_id: '00000000-0000-0000-0000-000000000000',
      created_by: user.id,
      rating,
      comment,
    });
    if (insErr) return { error: mapErr(insErr.message, insErr.code) };
  }

  revalidate(event_id);
  return { success: true };
}

export async function deleteTeamEvaluation(
  input: unknown,
): Promise<ActionResult> {
  const parsed = deleteTeamEvaluationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('team_evaluations')
    .delete()
    .eq('event_id', event_id);
  if (error) return { error: mapErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// F8.4 — Nota PRIVADA del staff por (event_id, player_id). Tabla aparte
// (evaluation_private_notes, 8.1): interna, nunca visible a jugador/familia. La
// FK a `evaluations` exige que el jugador tenga ya su valoración individual →
// el INSERT sin esa fila devuelve 'needs_evaluation' (la UI lo previene).
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertPrivateNote(input: unknown): Promise<ActionResult> {
  const parsed = upsertPrivateNoteSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id, note } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthenticated' };

  // Upsert "a mano": UPDATE del campo mutable; si no había fila, INSERT. No
  // usamos .upsert() porque tocaría created_by (inmutable: editor ≠ creador).
  const { data: updated, error: updErr } = await supabase
    .from('evaluation_private_notes')
    .update({ note })
    .eq('event_id', event_id)
    .eq('player_id', player_id)
    .select('player_id');
  if (updErr) return { error: mapErr(updErr.message, updErr.code) };

  if (!updated || updated.length === 0) {
    const { error: insErr } = await supabase
      .from('evaluation_private_notes')
      .insert({
        event_id,
        player_id,
        created_by: user.id, // forzado por el trigger; lo pasamos por el NOT NULL.
        note,
      });
    if (insErr) return { error: mapErr(insErr.message, insErr.code) };
  }

  revalidate(event_id);
  return { success: true };
}

export async function deletePrivateNote(input: unknown): Promise<ActionResult> {
  const parsed = deletePrivateNoteSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('evaluation_private_notes')
    .delete()
    .eq('event_id', event_id)
    .eq('player_id', player_id);
  if (error) return { error: mapErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}
