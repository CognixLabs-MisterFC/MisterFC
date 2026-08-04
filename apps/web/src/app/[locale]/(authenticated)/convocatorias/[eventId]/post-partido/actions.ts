'use server';

/**
 * F8.2 — Server actions de la etapa post-partido (valoraciones del partido).
 *
 * O2-9c — La lógica se EXTRAJO a core (`@misterfc/core` post-match): las 5 actions
 * de valoración pasan a DELEGAR (crear cliente con cookie → llamar al FromClient →
 * revalidar). El comportamiento es IDÉNTICO (misma persistencia upsert por
 * (event_id, player_id) contra `evaluations`/`team_evaluations`, misma autoridad
 * RLS `user_can_record_match`, 42501→'forbidden', mismos códigos de error); web y
 * app nativa comparten ahora una sola implementación. Las notas privadas (F8.4) NO
 * se extrajeron (fuera del alcance de 9c) y mantienen su lógica aquí.
 */

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServerClient,
  deleteEvaluationFromClient,
  deleteTeamEvaluationFromClient,
  setPostMatchDoneFromClient,
  upsertEvaluationFromClient,
  upsertTeamEvaluationFromClient,
  upsertPrivateNoteSchema,
  deletePrivateNoteSchema,
  type PostMatchOutcome,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type ActionResult = { success?: boolean; error?: string };

async function client() {
  const adapter = await createCookieAdapter();
  return createSupabaseServerClient(adapter);
}

function revalidate(eventId: string) {
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}/post-partido`,
    'page',
  );
  revalidatePath(`/[locale]/(authenticated)/convocatorias/${eventId}`, 'page');
}

function eventIdOf(input: unknown): string | null {
  if (input && typeof input === 'object' && 'event_id' in input) {
    const v = (input as { event_id?: unknown }).event_id;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/** Traduce el outcome del core a la forma web; revalida solo en éxito. */
function toResult(r: PostMatchOutcome, input: unknown): ActionResult {
  if (!r.ok) return { error: r.error };
  const id = eventIdOf(input);
  if (id) revalidate(id);
  return { success: true };
}

export async function upsertEvaluation(input: unknown): Promise<ActionResult> {
  const r = await upsertEvaluationFromClient(await client(), input);
  return toResult(r, input);
}

export async function deleteEvaluation(input: unknown): Promise<ActionResult> {
  const r = await deleteEvaluationFromClient(await client(), input);
  return toResult(r, input);
}

export async function setPostMatchDone(input: unknown): Promise<ActionResult> {
  const r = await setPostMatchDoneFromClient(await client(), input);
  return toResult(r, input);
}

export async function upsertTeamEvaluation(input: unknown): Promise<ActionResult> {
  const r = await upsertTeamEvaluationFromClient(await client(), input);
  return toResult(r, input);
}

export async function deleteTeamEvaluation(input: unknown): Promise<ActionResult> {
  const r = await deleteTeamEvaluationFromClient(await client(), input);
  return toResult(r, input);
}

// ─────────────────────────────────────────────────────────────────────────────
// F8.4 — Nota PRIVADA del staff por (event_id, player_id). Tabla aparte
// (evaluation_private_notes): interna, nunca visible a jugador/familia. NO
// extraída a core aún (fuera del alcance de 9c); mantiene su lógica aquí.
// ─────────────────────────────────────────────────────────────────────────────

function mapErr(message: string | undefined, code: string | undefined): string {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('player_not_in_team_at_event')) return 'invalid';
  if (message.includes('event_not_a_match')) return 'invalid';
  return 'generic';
}

export async function upsertPrivateNote(input: unknown): Promise<ActionResult> {
  const parsed = upsertPrivateNoteSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { event_id, player_id, note } = parsed.data;

  const supabase = await client();
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
        // club_id/team_id/created_by los DERIVA/fuerza el trigger; se pasan para
        // cumplir el NOT NULL en el tipo generado (el BEFORE trigger los reescribe).
        club_id: '00000000-0000-0000-0000-000000000000',
        team_id: '00000000-0000-0000-0000-000000000000',
        created_by: user.id,
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

  const supabase = await client();

  const { error } = await supabase
    .from('evaluation_private_notes')
    .delete()
    .eq('event_id', event_id)
    .eq('player_id', player_id);
  if (error) return { error: mapErr(error.message, error.code) };

  revalidate(event_id);
  return { success: true };
}
