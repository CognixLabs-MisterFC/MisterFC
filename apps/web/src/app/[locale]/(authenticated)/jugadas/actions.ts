'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { parsePlay, emptyPlay, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// F13.2 — Crear/editar jugadas. La RLS/trigger de 13.1b son el gate real; aquí
// hay pre-checks de autoridad para devolver errores claros. La forma del jsonb la
// valida `parsePlay` (core 13.1a) antes de persistir. Sin ciclo de estados (D2).
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'not_found' | 'generic';

export type PlayActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS
  return 'generic';
}

function revalidatePlays() {
  revalidatePath('/[locale]/(authenticated)/jugadas', 'page');
  revalidatePath('/[locale]/(authenticated)/jugadas/[id]/editar', 'page');
}

const createPlaySchema = z.object({
  team_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

const updatePlaySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).nullable(),
  description: z.string().trim().max(2000).nullable(),
  visibility: z.enum(['staff', 'team']),
  play: z.unknown(), // forma fuerte = parsePlay (abajo)
  locale: z.string().min(2).max(5), // para deep_link + texto de la notificación
});

/**
 * Crea una jugada (creación directa) sembrando 1 frame vacío con `emptyPlay()` y
 * redirige al editor (devuelve el id). El gate real es la RLS; el pre-check
 * `user_can_create_plays` (team-scoped) da un error claro si no hay autoridad.
 */
export async function createPlay(input: unknown): Promise<PlayActionState> {
  const parsed = createPlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // JR-0: las jugadas son del CLUB (banco). El equipo seleccionado en el alta se
  // ignora por ahora; en JR-2 se usará para crear la selección en team_plays.
  const { data: canCreate } = await supabase.rpc('user_can_create_plays', {
    p_club_id: ctx.activeClub.club.id,
  });
  if (!canCreate) return { error: 'forbidden' };

  const { data: created, error } = await supabase
    .from('plays')
    .insert({
      owner_profile_id: ctx.user.id,
      club_id: ctx.activeClub.club.id,
      name: parsed.data.name,
      play: emptyPlay(),
      // status = 'draft' por defecto (ciclo de aprobación, JR-1).
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  const id = created?.id as string | undefined;
  if (!id) return { error: 'generic' };

  revalidatePlays();
  return { success: true, id };
}

/**
 * Guarda la jugada: cabecera (name/description/visibility) + el jsonb `play`. El
 * `team_id` es INMUTABLE (trigger 13.1b) → no se toca aquí. La forma del jsonb se
 * valida con `parsePlay`; la autoría/edición la gatea la RLS (autor∪admin/coord).
 */
export async function updatePlay(input: unknown): Promise<PlayActionState> {
  const parsed = updatePlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const play = parsePlay(parsed.data.play);
  if (!play.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // JR-0: solo se guarda cabecera (name/description) + el jsonb. La visibilidad a
  // familia ya no vive aquí (pasa a team_plays.shared_with_family, JR-2) → el campo
  // `visibility` del input se ignora y NO se notifica al publicar (eso es JR-2).
  const { data: updated, error } = await supabase
    .from('plays')
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      play: play.data,
    })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}

// JR-0: notifyPlayPublished se elimina — la notificación de "compartido con la
// familia" se re-implementará sobre team_plays.shared_with_family en JR-2.

/** Borra una jugada (autor∪aprobador, gate = RLS). */
export async function deletePlay(input: unknown): Promise<PlayActionState> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.from('plays').delete().eq('id', parsed.data.id);
  if (error) return { error: mapPgErr(error.code) };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}
