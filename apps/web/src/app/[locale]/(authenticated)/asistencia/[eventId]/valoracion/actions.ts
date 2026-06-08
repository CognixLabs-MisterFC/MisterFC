'use server';

/**
 * F8.3 — Server actions de la valoración de ENTRENAMIENTO.
 *
 * Mismo modelo y schemas que el partido (8.2): upsert por (event_id, player_id)
 * contra `evaluations`, autoridad por RLS (`user_can_record_match`). Diferencias:
 * el rating es OPCIONAL (entreno) y NO hay post_match_done (los entrenos no
 * tienen ciclo de partido). El trigger deriva event_type del evento.
 */

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServerClient,
  upsertEvaluationSchema,
  deleteEvaluationSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type ActionResult = { success?: boolean; error?: string };

function mapErr(message: string | undefined, code: string | undefined): string {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('empty_evaluation')) return 'empty';
  if (message.includes('evaluations_one_mvp_per_event')) return 'mvp_taken';
  if (message.includes('player_not_in_team_at_event')) return 'invalid';
  return 'generic';
}

function revalidate(eventId: string) {
  revalidatePath(
    `/[locale]/(authenticated)/asistencia/${eventId}/valoracion`,
    'page',
  );
  revalidatePath(`/[locale]/(authenticated)/asistencia/${eventId}`, 'page');
}

export async function upsertTrainingEvaluation(
  input: unknown,
): Promise<ActionResult> {
  const parsed = upsertEvaluationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id, rating, comment, is_mvp } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthenticated' };

  // MVP único por evento: si pasa a MVP, desmarca al anterior primero.
  if (is_mvp) {
    const { error: clearErr } = await supabase
      .from('evaluations')
      .update({ is_mvp: false })
      .eq('event_id', event_id)
      .eq('is_mvp', true)
      .neq('player_id', player_id);
    if (clearErr) return { error: mapErr(clearErr.message, clearErr.code) };
  }

  // Upsert "a mano": UPDATE de los mutables; si no había fila, INSERT. No usamos
  // .upsert() porque tocaría created_by (inmutable: editor ≠ creador original).
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
      // club_id/team_id/event_type/created_by los DERIVA/fuerza el trigger; se
      // pasan para cumplir el NOT NULL antes del BEFORE trigger.
      club_id: '00000000-0000-0000-0000-000000000000',
      team_id: '00000000-0000-0000-0000-000000000000',
      event_type: 'training',
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

export async function deleteTrainingEvaluation(
  input: unknown,
): Promise<ActionResult> {
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
