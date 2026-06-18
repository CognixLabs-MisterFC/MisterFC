'use server';

import { revalidatePath } from 'next/cache';
import {
  createSessionSchema,
  updateSessionHeaderSchema,
  toSessionHeaderColumns,
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
