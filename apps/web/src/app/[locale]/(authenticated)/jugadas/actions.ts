'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { parsePlay, emptyPlay, createSupabaseServerClient, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// JR-1 (ADR-0019) — Banco de jugadas del club con ciclo de aprobación. Mirror del
// ciclo de EJERCICIOS (F11): crear borrador → proponer → publicar/rechazar
// (+ archivar). La RLS/trigger de JR-0 (plays_validate + user_can_create_plays /
// user_can_approve_plays) son el gate real; aquí hay pre-checks para errores
// claros. La forma del jsonb la valida `parsePlay`. El editor/animación no cambian.
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'not_found' | 'generic';

export type PlayActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

/** Aprobar/rechazar/archivar = admin∪coordinador (= user_can_approve_plays, D1). */
const APPROVER_ROLES: ReadonlyArray<Role> = ['admin_club', 'coordinador'];

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS
  return 'generic';
}

/** Revalida listado y editor (reflejan estado/acciones tras la mutación). */
function revalidatePlays() {
  revalidatePath('/[locale]/(authenticated)/jugadas', 'page');
  revalidatePath('/[locale]/(authenticated)/jugadas/[id]/editar', 'page');
}

const idSchema = z.object({ id: z.string().uuid() });

const createPlaySchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const updatePlaySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).nullable(),
  description: z.string().trim().max(2000).nullable(),
  play: z.unknown(), // forma fuerte = parsePlay (abajo)
});

/** Rechazo: exige motivo no vacío (el trigger de JR-0 también lo exige). */
const rejectPlaySchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
});

/**
 * Crea una jugada como BORRADOR del club (banco), sembrando 1 frame vacío con
 * `emptyPlay()`; redirige al editor (devuelve el id). El gate real es la RLS; el
 * pre-check `user_can_create_plays` (club-scoped) da un error claro si no hay
 * autoridad. Ya NO pide equipo (la selección por equipo es team_plays, JR-2).
 */
export async function createPlay(input: unknown): Promise<PlayActionState> {
  const parsed = createPlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

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
      // status = 'draft' por defecto (ciclo de aprobación).
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
 * Guarda CONTENIDO: cabecera (name/description) + el jsonb `play`. NO cambia el
 * estado (el ciclo va por acciones dedicadas). La forma del jsonb se valida con
 * `parsePlay`; la edición la gatea la RLS (autor de no-publicada ∪ aprobador).
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

/** Proponer desde el editor: borrador→propuesta por el autor (el trigger solo
 *  gatea →publicada/rechazada al aprobador, así que esta transición la hace el
 *  autor). RLS = gate. */
export async function proposePlay(input: unknown): Promise<PlayActionState> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('plays')
    .update({ status: 'proposed' })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}

/** Reproponer una rechazada: rechazada→propuesta por el autor, limpiando el motivo
 *  previo (el trigger solo limpia rejection_reason al publicar). RLS = gate. */
export async function reproposePlay(input: unknown): Promise<PlayActionState> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('plays')
    .update({ status: 'proposed', rejection_reason: null })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}

/**
 * Aprobar/publicar (solo aprobador): →publicada. Sirve para aprobar una propuesta
 * (proposed→published) y para publicar directo un borrador propio del aprobador
 * (draft→published). El trigger sella approved_by/approved_at. Notifica al
 * PROPONENTE (play_approved) salvo que sea el propio aprobador. `locale` solo para
 * el deep-link de la notificación.
 */
export async function approvePlay(input: unknown, locale: string): Promise<PlayActionState> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  if (!APPROVER_ROLES.includes(ctx.activeClub.role as Role)) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { id } = parsed.data;

  const { data: updated, error } = await supabase
    .from('plays')
    .update({ status: 'published' })
    .eq('id', id)
    .select('id, name, owner_profile_id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  // Notifica al autor (no bloquea la aprobación si el bus falla). No te avises a ti.
  const ownerId = updated.owner_profile_id as string;
  if (ownerId !== ctx.user.id) {
    try {
      const { emitNotification } = await import('@/lib/notify-bus');
      const deepLink = `/${locale}/jugadas/${id}/editar`;
      const name = (updated.name as string | null) ?? '';
      await emitNotification({
        user_id: ownerId,
        type: 'play_approved',
        in_app_payload: { play_id: id, play_name: name, deep_link: deepLink },
        push_payload: {
          title: name,
          body: '',
          deep_link: deepLink,
          tag: `play_approved:${id}`,
        },
        dedupe_base: `play_approved:${id}:${Date.now()}`,
      });
    } catch (notifyErr) {
      Sentry.captureException(notifyErr, {
        tags: { feature: 'plays', step: 'notify_approve' },
        extra: { play_id: id },
      });
    }
  }

  revalidatePlays();
  return { success: true, id };
}

/** Rechazar un propuesto → rechazado, con motivo OBLIGATORIO (solo aprobador).
 *  Notifica al autor (play_rejected). `locale` solo para el deep-link. */
export async function rejectPlay(input: unknown, locale: string): Promise<PlayActionState> {
  const parsed = rejectPlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  if (!APPROVER_ROLES.includes(ctx.activeClub.role as Role)) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { id, reason } = parsed.data;

  const { data: updated, error } = await supabase
    .from('plays')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', id)
    .select('id, name, owner_profile_id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  const ownerId = updated.owner_profile_id as string;
  if (ownerId !== ctx.user.id) {
    try {
      const { emitNotification } = await import('@/lib/notify-bus');
      const deepLink = `/${locale}/jugadas/${id}/editar`;
      const name = (updated.name as string | null) ?? '';
      await emitNotification({
        user_id: ownerId,
        type: 'play_rejected',
        in_app_payload: { play_id: id, play_name: name, reason, deep_link: deepLink },
        push_payload: {
          title: name,
          body: reason,
          deep_link: deepLink,
          tag: `play_rejected:${id}`,
        },
        // Único por rechazo: un re-rechazo tras corregir debe volver a avisar.
        dedupe_base: `play_rejected:${id}:${Date.now()}`,
      });
    } catch (notifyErr) {
      Sentry.captureException(notifyErr, {
        tags: { feature: 'plays', step: 'notify_reject' },
        extra: { play_id: id },
      });
    }
  }

  revalidatePlays();
  return { success: true, id };
}

/** Archivar (solo aprobador, solo publicadas): pone archived_at; deja de salir en
 *  el listado por defecto (que filtra archived_at IS NULL). El trigger lo gatea. */
export async function archivePlay(input: unknown): Promise<PlayActionState> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: updated, error } = await supabase
    .from('plays')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}

/** Borra una jugada (autor de no-publicada ∪ aprobador de no-publicada; las
 *  publicadas se archivan, no se borran). El gate real es la RLS. */
export async function deletePlay(input: unknown): Promise<PlayActionState> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.from('plays').delete().eq('id', parsed.data.id);
  if (error) return { error: mapPgErr(error.code) };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}
