'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  createExerciseSchema,
  updateExerciseSchema,
  exerciseIdSchema,
  rejectExerciseSchema,
  statusForAction,
  statusForUpdate,
  toExerciseColumns,
  createSupabaseServerClient,
  type Role,
  type MethodologyStatus,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// F11.6 — Crear ejercicio (flujo A: borrador + proponer; Admin publica directo).
// La RLS/trigger de 11.1 son el gate real; aquí hay pre-checks de autoridad para
// devolver errores claros antes de tocar la BD.
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'name_taken' | 'not_found' | 'generic';

export type ExerciseActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS
  if (code === '23505') return 'name_taken'; // colisión de nombre (si hubiera unique)
  return 'generic';
}

/** Revalida listado y ficha (la ficha refleja estado/acciones tras la mutación). */
function revalidateExercises() {
  revalidatePath('/[locale]/(authenticated)/ejercicios', 'page');
  revalidatePath('/[locale]/(authenticated)/ejercicios/[id]', 'page');
}

export async function createExercise(input: unknown): Promise<ExerciseActionState> {
  const parsed = createExerciseSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const isAdmin = (ctx.activeClub.role as Role) === 'admin_club';
  const status = statusForAction(parsed.data.action, isAdmin);
  if (status === null) return { error: 'forbidden' }; // p.ej. no-Admin pidiendo publicar

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // Pre-check de autoría (defensa en profundidad; la RLS de INSERT lo repite).
  const { data: canCreate } = await supabase.rpc('user_can_create_exercises', {
    p_club_id: clubId,
  });
  if (!canCreate) return { error: 'forbidden' };

  const columns = toExerciseColumns(parsed.data, status);

  const { data: created, error } = await supabase
    .from('exercises')
    .insert({
      owner_profile_id: ctx.user.id,
      club_id: clubId,
      ...columns,
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  const id = created?.id as string | undefined;
  if (!id) return { error: 'generic' };

  revalidatePath('/[locale]/(authenticated)/ejercicios', 'page');
  return { success: true, id };
}

// ─────────────────────────────────────────────────────────────────────────────
// F11.6 PR2 — Editar + ciclo de vida (proponer / borrar / archivar).
// Todo confía en la RLS/trigger de 11.1 como gate real; los pre-checks solo dan
// errores claros. No se reimplementan permisos.
// ─────────────────────────────────────────────────────────────────────────────

export async function updateExercise(input: unknown): Promise<ExerciseActionState> {
  const parsed = updateExerciseSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const isAdmin = (ctx.activeClub.role as Role) === 'admin_club';

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { id, action } = parsed.data;

  // Estado actual (RLS-scoped): si no se ve, no se puede editar.
  const { data: current } = await supabase
    .from('exercises')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (!current) return { error: 'not_found' };

  const currentStatus = current.status as MethodologyStatus;
  const status = statusForUpdate(currentStatus, action, isAdmin);
  if (status === null) return { error: 'forbidden' };

  const columns = toExerciseColumns(parsed.data, status);
  // Al corregir un rechazado y reproponerlo/guardarlo, limpia el motivo previo.
  const clearReason = currentStatus === 'rejected' && status !== 'rejected';
  const { data: updated, error } = await supabase
    .from('exercises')
    .update(clearReason ? { ...columns, rejection_reason: null } : columns)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateExercises();
  return { success: true, id };
}

/** Proponer desde la ficha: borrador→propuesto por el autor (sin pasar por el
 *  form). El trigger de 11.1 solo gatea →publicado/rechazado a Admin, así que la
 *  transición a 'proposed' la hace el autor. RLS = gate. */
export async function proposeExercise(input: unknown): Promise<ExerciseActionState> {
  const parsed = exerciseIdSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('exercises')
    .update({ status: 'proposed' })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateExercises();
  return { success: true, id: parsed.data.id };
}

/** Borrar (hard delete): autor de borrador/propuesto/rechazado, o Admin de
 *  cualquiera no publicado. Los publicados se ARCHIVAN, no se borran. RLS = gate. */
export async function deleteExercise(input: unknown): Promise<ExerciseActionState> {
  const parsed = exerciseIdSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.from('exercises').delete().eq('id', parsed.data.id);
  if (error) return { error: mapPgErr(error.code) };

  revalidateExercises();
  return { success: true };
}

/** Archivar (solo Admin, solo publicados): pone archived_at; deja de salir en el
 *  listado (que filtra archived_at IS NULL). El trigger gatea publicado+Admin. */
export async function archiveExercise(input: unknown): Promise<ExerciseActionState> {
  const parsed = exerciseIdSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('exercises')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateExercises();
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// F11.7 — Ciclo de metodología: aprobar / rechazar (solo Admin). El trigger de
// 11.1 sella approved_by/at al publicar y exige motivo + Admin al rechazar; la
// RLS UPDATE deja al Admin transicionar. Aquí confiamos en ese gate.
// ─────────────────────────────────────────────────────────────────────────────

/** Aprobar un propuesto → publicado. El trigger setea approved_by/approved_at. */
export async function approveExercise(input: unknown): Promise<ExerciseActionState> {
  const parsed = exerciseIdSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('exercises')
    .update({ status: 'published' })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateExercises();
  return { success: true, id: parsed.data.id };
}

/** Rechazar un propuesto → rechazado, con motivo OBLIGATORIO. Notifica al autor
 *  (exercise_rejected) reusando el bus de notificaciones (F5). `locale` solo se
 *  usa para el deep-link de la notificación. */
export async function rejectExercise(
  input: unknown,
  locale: string
): Promise<ExerciseActionState> {
  const parsed = rejectExerciseSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { id, reason } = parsed.data;

  const { data: updated, error } = await supabase
    .from('exercises')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', id)
    .select('id, name, owner_profile_id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  // Notifica al autor (no bloquea el rechazo si el bus falla).
  try {
    const { emitNotification } = await import('@/lib/notify-bus');
    const deepLink = `/${locale}/ejercicios/${id}`;
    await emitNotification({
      user_id: updated.owner_profile_id as string,
      type: 'exercise_rejected',
      in_app_payload: {
        exercise_id: id,
        exercise_name: updated.name as string,
        reason,
        deep_link: deepLink,
      },
      push_payload: {
        title: updated.name as string,
        body: reason,
        deep_link: deepLink,
        tag: `exercise_rejected:${id}`,
      },
      // Único por rechazo: un re-rechazo tras corregir debe volver a avisar.
      dedupe_base: `exercise_rejected:${id}:${Date.now()}`,
    });
  } catch (notifyErr) {
    Sentry.captureException(notifyErr, {
      tags: { feature: 'exercises', step: 'notify_reject' },
      extra: { exercise_id: id },
    });
  }

  revalidateExercises();
  return { success: true, id };
}
