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
  addBlockPlaySchema,
  updateBlockPlaySchema,
  toPlayOverrideColumns,
  blockPlayIdSchema,
  reorderBlockPlaysSchema,
  saveAsTemplateSchema,
  createFromTemplateSchema,
  sessionIdSchema,
  planSessionForEventSchema,
  linkSessionToEventSchema,
  sessionDateFromEventStart,
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

type ActionError = 'forbidden' | 'invalid' | 'not_found' | 'conflict' | 'generic';

export type SessionActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS / gate del RPC
  if (code === 'P0002') return 'not_found'; // no_data_found (RAISE del RPC)
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
 *
 * 12.8a — si se pasa `event_id` (vincular a un entrenamiento), HEREDA fecha y equipo
 * del evento (autoritativo, leído server-side) e ignora los team_id/session_date del
 * input. El evento debe ser un `training` del club activo.
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

  // Valores por defecto (alta manual). Si hay event_id, se sobrescriben con los del
  // evento (12.8a).
  let teamId = parsed.data.team_id ?? null;
  let sessionDate = parsed.data.session_date ?? todayIso();
  let eventId: string | null = null;

  if (parsed.data.event_id) {
    const { data: ev } = await supabase
      .from('events')
      .select('starts_at, team_id, type, club_id')
      .eq('id', parsed.data.event_id)
      .maybeSingle();
    // Solo se vincula a un entrenamiento del club activo.
    if (!ev || ev.club_id !== clubId || ev.type !== 'training') return { error: 'invalid' };
    eventId = parsed.data.event_id;
    teamId = (ev.team_id as string | null) ?? null;
    sessionDate = sessionDateFromEventStart(ev.starts_at as string);
  }

  const { data: created, error } = await supabase
    .from('sessions')
    .insert({
      owner_profile_id: ctx.user.id,
      club_id: clubId,
      team_id: teamId,
      session_date: sessionDate,
      event_id: eventId,
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
 * F12.8a — "Planificar sesión" desde un evento de entrenamiento del calendario.
 * LINK-OR-CREATE (idempotente, 1:1): si el evento ya tiene una sesión vinculada,
 * devuelve su id; si no, crea una nueva (heredando fecha/equipo del evento y
 * sembrando el esqueleto) vía createSession. El botón redirige al editor con el id.
 */
export async function planSessionForEvent(input: unknown): Promise<SessionActionState> {
  const parsed = planSessionForEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // ¿Ya hay sesión vinculada a este evento? (RLS = gate; el staff ve las del club).
  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('event_id', parsed.data.event_id)
    .eq('is_template', false)
    .maybeSingle();
  if (existing?.id) return { success: true, id: existing.id as string };

  return createSession({ event_id: parsed.data.event_id });
}

/** Sesión candidata a vincular: suelta (sin evento) del mismo equipo. */
export type LinkableSession = {
  id: string;
  title: string | null;
  session_date: string | null;
};

export type PlanSessionOptionsState = {
  error?: ActionError;
  /** Si el evento ya tiene una sesión vinculada, su id (camino "abrir"). */
  linkedSessionId?: string | null;
  /** Sesiones de ese equipo sin evento (camino "vincular existente"). */
  candidates?: LinkableSession[];
};

/**
 * F12.8 (D2) — Opciones del flujo "Planificar sesión" de un entrenamiento:
 *  · si ya tiene sesión vinculada → su id (la UI ofrece abrirla);
 *  · si no → las sesiones SUELTAS (event_id null, is_template=false) del MISMO
 *    equipo, candidatas a vincular. RLS = gate (el staff ve las del club).
 */
export async function loadPlanSessionOptions(input: unknown): Promise<PlanSessionOptionsState> {
  const parsed = planSessionForEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // El evento debe ser un entrenamiento DE EQUIPO del club activo.
  const { data: ev } = await supabase
    .from('events')
    .select('team_id, type, club_id')
    .eq('id', parsed.data.event_id)
    .maybeSingle();
  if (!ev || ev.club_id !== clubId || ev.type !== 'training') return { error: 'invalid' };
  const teamId = (ev.team_id as string | null) ?? null;
  if (!teamId) return { error: 'invalid' };

  // ¿Ya hay sesión vinculada?
  const { data: linked } = await supabase
    .from('sessions')
    .select('id')
    .eq('event_id', parsed.data.event_id)
    .eq('is_template', false)
    .maybeSingle();
  if (linked?.id) return { linkedSessionId: linked.id as string, candidates: [] };

  // Sesiones sueltas del mismo equipo (sin evento), más recientes primero.
  const { data: rows } = await supabase
    .from('sessions')
    .select('id, title, session_date')
    .eq('club_id', clubId)
    .eq('team_id', teamId)
    .eq('is_template', false)
    .is('event_id', null)
    .order('session_date', { ascending: false, nullsFirst: false })
    .limit(100);

  const candidates: LinkableSession[] = (rows ?? []).map((s) => ({
    id: s.id as string,
    title: (s.title as string | null) ?? null,
    session_date: (s.session_date as string | null) ?? null,
  }));

  return { linkedSessionId: null, candidates };
}

/**
 * F12.8 (D2) — Vincula una sesión EXISTENTE (suelta) a un entrenamiento. Set
 * event_id + session_date = fecha del evento (consistencia). Respeta el 1:1: solo
 * actualiza sesiones del club, no plantilla y AÚN sin evento; un choque con el
 * UNIQUE (event_id ya usado) → 'conflict'. La RLS de UPDATE es el gate real.
 */
export async function linkSessionToEvent(input: unknown): Promise<SessionActionState> {
  const parsed = linkSessionToEventSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // Lee el evento (autoritativo): training de equipo del club activo + su fecha.
  const { data: ev } = await supabase
    .from('events')
    .select('starts_at, team_id, type, club_id')
    .eq('id', parsed.data.event_id)
    .maybeSingle();
  if (!ev || ev.club_id !== clubId || ev.type !== 'training') return { error: 'invalid' };
  const teamId = (ev.team_id as string | null) ?? null;
  if (!teamId) return { error: 'invalid' };
  const sessionDate = sessionDateFromEventStart(ev.starts_at as string);

  // Solo vincula sesiones del club, del MISMO equipo, no plantilla y SIN evento
  // (event_id null). Si la fila no encaja → not_found; si choca el UNIQUE → conflict.
  const { data: updated, error } = await supabase
    .from('sessions')
    .update({ event_id: parsed.data.event_id, session_date: sessionDate })
    .eq('id', parsed.data.session_id)
    .eq('club_id', clubId)
    .eq('team_id', teamId)
    .eq('is_template', false)
    .is('event_id', null)
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return { error: 'conflict' };
    return { error: mapPgErr(error.code) };
  }
  if (!updated) return { error: 'not_found' };

  revalidateSessions();
  return { success: true, id: parsed.data.session_id };
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
 * F12.4 (+ F14E-4) — Comparte/descomparte una sesión con el equipo.
 * "Compartida" = visibility='team' (visible read-only para jugadores/familias del
 * team_id, sin condición de convocatoria); "no compartida" = 'staff'.
 *
 * Pasa por el RPC `set_session_shared` (SECURITY DEFINER) en vez de un UPDATE
 * directo: el RPC AMPLÍA el gate (staff del equipo —incl. AYUDANTE sin capability—
 * ∪ admin/director/superadmin), mientras que el UPDATE directo exigía autoridad de
 * creación (owner∪admin∪staff-con-capability). Revalida también /mi-equipo y la
 * pantalla de planificación del jugador (superficie del jugador/familia).
 */
export async function setSessionVisibility(input: unknown): Promise<SessionActionState> {
  const parsed = setSessionVisibilitySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('set_session_shared', {
    p_session_id: parsed.data.id,
    p_shared: parsed.data.visibility === 'team',
  });

  if (error) return { error: mapPgErr(error.code) };

  revalidateSessions();
  revalidatePath('/[locale]/(authenticated)/mi-equipo', 'page');
  revalidatePath('/[locale]/(authenticated)/mi-equipo/sesiones', 'page');
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

// ─────────────────────────────────────────────────────────────────────────────
// F12.6 — Plantillas: guardar como plantilla / crear desde plantilla / borrar.
// El clonado es ATÓMICO vía el RPC clone_session (12.6); la RLS de 12.1 es el gate
// real. Pre-check de autoría como en createSession (defensa en profundidad).
// ─────────────────────────────────────────────────────────────────────────────

/** Guarda la sesión actual como una plantilla nueva (is_template, sin fecha/equipo). */
export async function saveSessionAsTemplate(input: unknown): Promise<SessionActionState> {
  const parsed = saveAsTemplateSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: id, error } = await supabase.rpc('clone_session', {
    p_source_id: parsed.data.source_id,
    p_is_template: true,
    p_title: parsed.data.title,
  });

  if (error) return { error: mapPgErr(error.code) };
  if (!id) return { error: 'generic' };

  revalidateSessions();
  return { success: true, id: id as string };
}

/**
 * Crea una sesión REAL desde una plantilla (clona bloques + ejercicios a la fecha +
 * equipo elegidos). NO siembra el esqueleto por defecto (lo hace el clonado: copia
 * los bloques de la plantilla). Devuelve el id para redirigir al editor.
 */
export async function createSessionFromTemplate(input: unknown): Promise<SessionActionState> {
  const parsed = createFromTemplateSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: id, error } = await supabase.rpc('clone_session', {
    p_source_id: parsed.data.template_id,
    p_is_template: false,
    p_session_date: parsed.data.session_date ?? todayIso(),
    p_team_id: parsed.data.team_id ?? undefined,
  });

  if (error) return { error: mapPgErr(error.code) };
  if (!id) return { error: 'generic' };

  revalidateSessions();
  return { success: true, id: id as string };
}

/** Borra una plantilla (RLS de DELETE = gate: owner∪admin). */
export async function deleteTemplate(input: unknown): Promise<SessionActionState> {
  const parsed = sessionIdSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', parsed.data.id)
    .eq('is_template', true);

  if (error) return { error: mapPgErr(error.code) };

  revalidateSessions();
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// JS-1 (F12↔F13) — Jugadas del bloque (añadir del playbook / overrides / quitar /
// reordenar). session_id/club_id los DERIVA el trigger de JS-0; total_minutes lo
// recalcula el trigger de JS-0 (suma ejercicios ∪ jugadas). La RLS
// (user_can_edit_session + jugada en el playbook del equipo de la sesión) es el gate.
// ─────────────────────────────────────────────────────────────────────────────

export type SessionPlayActionState = {
  error?: ActionError;
  success?: boolean;
  /** id de la fila creada (addPlayToBlock). */
  id?: string;
};

/** Añade una jugada del playbook al final de un bloque (overrides del día vacíos). */
export async function addPlayToBlock(input: unknown): Promise<SessionPlayActionState> {
  const parsed = addBlockPlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { block_id, play_id } = parsed.data;

  // session_id/club_id los deriva el trigger del bloque, pero el tipo Insert los
  // exige (NOT NULL sin default) → se leen del bloque (RLS decide si se ve) y se
  // pasan; el trigger los re-deriva al mismo valor.
  const { data: block } = await supabase
    .from('session_blocks')
    .select('session_id, club_id')
    .eq('id', block_id)
    .maybeSingle();
  if (!block) return { error: 'not_found' };

  // Siguiente order_idx del bloque (huecos OK; el orden lo normaliza reorder).
  const { data: last } = await supabase
    .from('session_block_plays')
    .select('order_idx')
    .eq('block_id', block_id)
    .order('order_idx', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIdx = ((last?.order_idx as number | null) ?? -1) + 1;

  const { data: created, error } = await supabase
    .from('session_block_plays')
    .insert({
      block_id,
      session_id: block.session_id,
      club_id: block.club_id,
      play_id,
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

/** Edita los overrides del día de una jugada en sesión (duración/notas — D7). */
export async function updateBlockPlay(input: unknown): Promise<SessionPlayActionState> {
  const parsed = updateBlockPlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('session_block_plays')
    .update(toPlayOverrideColumns(parsed.data))
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidateSessions();
  return { success: true, id: parsed.data.id };
}

/** Quita una jugada de un bloque (borra el join). */
export async function removePlayFromBlock(input: unknown): Promise<SessionPlayActionState> {
  const parsed = blockPlayIdSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('session_block_plays')
    .delete()
    .eq('id', parsed.data.id);

  if (error) return { error: mapPgErr(error.code) };

  revalidateSessions();
  return { success: true };
}

/** Reordena las jugadas dentro de un bloque (RPC: una sentencia, UNIQUE deferrable). */
export async function reorderBlockPlays(input: unknown): Promise<SessionActionState> {
  const parsed = reorderBlockPlaysSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('reorder_session_block_plays', {
    p_block_id: parsed.data.block_id,
    p_play_ids: parsed.data.play_ids,
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
