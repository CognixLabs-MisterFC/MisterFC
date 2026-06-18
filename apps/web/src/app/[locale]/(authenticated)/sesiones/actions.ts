'use server';

import { revalidatePath } from 'next/cache';
import {
  createSessionSchema,
  updateSessionHeaderSchema,
  setSessionVisibilitySchema,
  toSessionHeaderColumns,
  addBlockTaskSchema,
  updateBlockTaskSchema,
  toTaskOverrideColumns,
  blockTaskIdSchema,
  reorderBlocksSchema,
  reorderTasksSchema,
  moveTaskSchema,
  buildDefaultSkeleton,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// F12.2 — Crear sesión + editar cabecera. La RLS/trigger de 12.1 son el gate
// real; aquí hay pre-checks de autoridad para devolver errores claros. No se
// reimplementan permisos. Sin ciclo de estados (D2): creación directa.
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'not_found' | 'generic';

export type SessionActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS
  return 'generic';
}

function revalidateSessions() {
  revalidatePath('/[locale]/(authenticated)/sesiones', 'page');
  revalidatePath('/[locale]/(authenticated)/sesiones/[id]/editar', 'page');
}

/** Fecha de hoy en formato YYYY-MM-DD (zona del servidor). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Crea una sesión (creación directa) y SIEMBRA el esqueleto estándar (5 bloques)
 * con `buildDefaultSkeleton()` de core. Si la siembra falla tras crear la cabecera,
 * borra la cabecera para no dejar una sesión sin bloques (best-effort). Devuelve
 * el id para redirigir al editor.
 */
export async function createSession(input: unknown): Promise<SessionActionState> {
  const parsed = createSessionSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // Pre-check de autoría (defensa en profundidad; la RLS de INSERT lo repite).
  const { data: canCreate } = await supabase.rpc('user_can_create_sessions', {
    p_club_id: clubId,
  });
  if (!canCreate) return { error: 'forbidden' };

  const { data: created, error } = await supabase
    .from('sessions')
    .insert({
      owner_profile_id: ctx.user.id,
      club_id: clubId,
      team_id: parsed.data.team_id ?? null,
      session_date: parsed.data.session_date ?? todayIso(),
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  const id = created?.id as string | undefined;
  if (!id) return { error: 'generic' };

  // Siembra del esqueleto (los 5 bloques). club_id lo deriva el trigger del padre,
  // pero lo pasamos explícito por claridad.
  const blocks = buildDefaultSkeleton().map((b) => ({
    session_id: id,
    club_id: clubId,
    block_type: b.block_type,
    order_idx: b.order_idx,
  }));
  const { error: blocksError } = await supabase.from('session_blocks').insert(blocks);

  if (blocksError) {
    // Limpieza best-effort: una sesión sin bloques no es usable.
    await supabase.from('sessions').delete().eq('id', id);
    return { error: mapPgErr(blocksError.code) };
  }

  revalidateSessions();
  return { success: true, id };
}

/**
 * Actualiza la cabecera de una sesión. Confía en la RLS (owner∪admin) como gate;
 * si no se ve/edita, no hay fila → not_found. No toca visibility (publicar = 12.4).
 */
export async function updateSessionHeader(input: unknown): Promise<SessionActionState> {
  const parsed = updateSessionHeaderSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const columns = toSessionHeaderColumns(parsed.data);
  const { data: updated, error } = await supabase
    .from('sessions')
    .update(columns)
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateSessions();
  return { success: true, id: parsed.data.id };
}

/**
 * F12.4 — Publica/despublica una sesión al equipo (visibility 'staff'↔'team').
 * Publicar la hace visible read-only para jugadores y familias del team_id (D3).
 * Confía en la RLS de UPDATE (owner∪admin) como gate; si no se edita, not_found.
 * Revalida también /mi-equipo (la superficie del jugador/familia).
 */
export async function setSessionVisibility(input: unknown): Promise<SessionActionState> {
  const parsed = setSessionVisibilitySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('sessions')
    .update({ visibility: parsed.data.visibility })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateSessions();
  revalidatePath('/[locale]/(authenticated)/mi-equipo', 'page');
  return { success: true, id: parsed.data.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// F12.2b — Tareas del bloque (añadir/editar overrides/quitar) + reordenar.
// session_id/club_id de la tarea los DERIVA el trigger de 12.1; total_minutes lo
// recalcula el trigger de 12.2b. La RLS (user_can_edit_session) es el gate real.
// ─────────────────────────────────────────────────────────────────────────────

export type SessionTaskActionState = {
  error?: ActionError;
  success?: boolean;
  /** id de la tarea creada (addBlockTask). */
  id?: string;
};

/** Añade un ejercicio al final de un bloque (overrides del día vacíos). */
export async function addBlockTask(input: unknown): Promise<SessionTaskActionState> {
  const parsed = addBlockTaskSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { block_id, exercise_id } = parsed.data;

  // session_id/club_id de la tarea: el trigger de 12.1 los deriva del bloque, pero
  // el tipo Insert los exige (NOT NULL sin default) → los leemos del bloque (RLS
  // decide si se ve) y los pasamos; el trigger los re-deriva al mismo valor.
  const { data: block } = await supabase
    .from('session_blocks')
    .select('session_id, club_id')
    .eq('id', block_id)
    .maybeSingle();
  if (!block) return { error: 'not_found' };

  // Siguiente order_idx del bloque (huecos OK; el orden lo normaliza reorder).
  const { data: last } = await supabase
    .from('session_block_exercises')
    .select('order_idx')
    .eq('block_id', block_id)
    .order('order_idx', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIdx = ((last?.order_idx as number | null) ?? -1) + 1;

  const { data: created, error } = await supabase
    .from('session_block_exercises')
    .insert({
      block_id,
      session_id: block.session_id,
      club_id: block.club_id,
      exercise_id,
      order_idx: nextIdx,
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  const id = created?.id as string | undefined;
  if (!id) return { error: 'generic' };

  revalidateSessions();
  return { success: true, id };
}

/** Edita los overrides del día de una tarea (duración/series/notas). */
export async function updateBlockTask(input: unknown): Promise<SessionTaskActionState> {
  const parsed = updateBlockTaskSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('session_block_exercises')
    .update(toTaskOverrideColumns(parsed.data))
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateSessions();
  return { success: true, id: parsed.data.id };
}

/** Quita una tarea de un bloque (borra el join). */
export async function removeBlockTask(input: unknown): Promise<SessionTaskActionState> {
  const parsed = blockTaskIdSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('session_block_exercises')
    .delete()
    .eq('id', parsed.data.id);

  if (error) return { error: mapPgErr(error.code) };

  revalidateSessions();
  return { success: true };
}

/** Reordena los bloques de la sesión (RPC: una sentencia, UNIQUE deferrable). */
export async function reorderBlocks(input: unknown): Promise<SessionActionState> {
  const parsed = reorderBlocksSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('reorder_session_blocks', {
    p_session_id: parsed.data.session_id,
    p_block_ids: parsed.data.block_ids,
  });

  if (error) return { error: mapPgErr(error.code) };

  revalidateSessions();
  return { success: true, id: parsed.data.session_id };
}

/** Reordena las tareas dentro de un bloque (RPC: una sentencia, UNIQUE deferrable). */
export async function reorderTasks(input: unknown): Promise<SessionActionState> {
  const parsed = reorderTasksSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('reorder_session_tasks', {
    p_block_id: parsed.data.block_id,
    p_task_ids: parsed.data.task_ids,
  });

  if (error) return { error: mapPgErr(error.code) };

  revalidateSessions();
  return { success: true, id: parsed.data.block_id };
}

/** Mueve una tarea a otro bloque de la misma sesión (RPC: cambia block_id +
 *  reindexa el destino en una sentencia). */
export async function moveTask(input: unknown): Promise<SessionActionState> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('move_session_task', {
    p_task_id: parsed.data.task_id,
    p_to_block_id: parsed.data.to_block_id,
    p_dest_ids: parsed.data.dest_ids,
  });

  if (error) return { error: mapPgErr(error.code) };

  revalidateSessions();
  return { success: true, id: parsed.data.task_id };
}
