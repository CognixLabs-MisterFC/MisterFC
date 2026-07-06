'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  parsePlay,
  emptyPlay,
  createSupabaseServerClient,
  createSupabaseAdminClient,
  STRATEGY_TYPES,
  type Role,
  ADMIN_ROLES,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// JR-1 (ADR-0019) — Banco de jugadas del club con ciclo de aprobación. Mirror del
// ciclo de EJERCICIOS (F11): crear borrador → proponer → publicar/rechazar
// (+ archivar). La RLS/trigger de JR-0 (plays_validate + user_can_create_plays /
// user_can_approve_plays) son el gate real; aquí hay pre-checks para errores
// claros. La forma del jsonb la valida `parsePlay`. El editor/animación no cambian.
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'not_found' | 'generic' | 'design_locked';

export type PlayActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

/** Aprobar/rechazar/archivar = admin∪coordinador (= user_can_approve_plays, D1). */
const APPROVER_ROLES: ReadonlyArray<Role> = ADMIN_ROLES;

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
  // Jugada de estrategia: el TIPO es de la jugada (igual para todos los equipos) y
  // es OBLIGATORIO aquí. La SEÑA NO va aquí: es por equipo y se elige al añadir/
  // gestionar la jugada en el playbook del equipo (team_plays).
  strategy_type: z.enum(STRATEGY_TYPES),
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

  // Pre-check de UX (defensa en profundidad; el gate real sigue siendo la RLS): el
  // diseño de una jugada PUBLICADA solo lo edita en sitio un aprobador (ciclo de
  // aprobación, JR-0). Para un no-aprobador la RLS de UPDATE filtraría la fila y el
  // resultado sería un no-op mudo (0 filas → 'not_found' confuso). Lo detectamos
  // antes y devolvemos un error claro. NO tocamos la RLS ni el ciclo.
  const isApprover = APPROVER_ROLES.includes(ctx.activeClub.role as Role);
  if (!isApprover) {
    const { data: current } = await supabase
      .from('plays')
      .select('status')
      .eq('id', parsed.data.id)
      .maybeSingle();
    if (!current) return { error: 'not_found' };
    if (current.status === 'published') return { error: 'design_locked' };
  }

  const { data: updated, error } = await supabase
    .from('plays')
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      play: play.data,
      strategy_type: parsed.data.strategy_type,
    })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!updated) return { error: 'not_found' };

  revalidatePlays();
  return { success: true, id: parsed.data.id };
}

/**
 * "Proponer cambios" sobre una jugada PUBLICADA (salida para el no-aprobador que ve
 * el banner #242). En vez de editar en sitio (lo que el ciclo reserva a aprobadores),
 * crea una COPIA NUEVA en 'proposed' con los cambios del proponente (owner = él) y
 * `source_play_id` = la original. La ORIGINAL no se toca y sigue 'published' en uso.
 * La copia entra en la cola de revisión existente (status='proposed'); el coordinador
 * la aprueba/rechaza con el ciclo de siempre. Mismas reglas de alta que cualquier
 * jugada: plays_insert (owner=auth.uid() AND user_can_create_plays) + trigger JR-0.
 */
export async function proposePlayChanges(input: unknown): Promise<PlayActionState> {
  const parsed = updatePlaySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const play = parsePlay(parsed.data.play);
  if (!play.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // La original debe existir, ser visible y estar PUBLICADA: solo se "proponen
  // cambios" sobre publicadas (el resto se edita por el flujo normal del ciclo).
  const { data: source } = await supabase
    .from('plays')
    .select('id, club_id, status')
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!source) return { error: 'not_found' };
  if (source.status !== 'published') return { error: 'invalid' };

  // Pre-check claro de autoría (la RLS de INSERT sigue siendo el gate real).
  const { data: canCreate } = await supabase.rpc('user_can_create_plays', {
    p_club_id: source.club_id as string,
  });
  if (!canCreate) return { error: 'forbidden' };

  const { data: created, error } = await supabase
    .from('plays')
    .insert({
      owner_profile_id: ctx.user.id, // el trigger igualmente fuerza auth.uid()
      club_id: source.club_id as string,
      name: parsed.data.name,
      description: parsed.data.description,
      play: play.data,
      status: 'proposed',
      strategy_type: parsed.data.strategy_type,
      source_play_id: source.id as string,
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  const id = created?.id as string | undefined;
  if (!id) return { error: 'generic' };

  revalidatePlays();
  return { success: true, id };
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

const resolveProposalSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(['replace', 'new']),
});

/**
 * B1 (v2 de propuestas) — al APROBAR una propuesta de cambios (con source_play_id),
 * el coordinador elige:
 *   · mode='new'     → la propuesta pasa a published como jugada propia (= v1; la
 *                      original intacta; source_play_id se conserva como "derivada de").
 *   · mode='replace' → SUSTITUIR: la RPC vuelca la propuesta sobre la original (mismo
 *                      registro published; team_plays/señas intactos) y consume la
 *                      propuesta, atómicamente. Avisa al STAFF de los equipos que tienen
 *                      la jugada (play_updated) + al proponente (play_approved).
 * Gate: aprobador (la RPC lo revalida en BD). `locale` solo para los deep-links.
 */
export async function resolvePlayProposal(
  input: unknown,
  locale: string,
): Promise<PlayActionState> {
  const parsed = resolveProposalSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  if (!APPROVER_ROLES.includes(ctx.activeClub.role as Role)) return { error: 'forbidden' };

  // (B) Publicar como jugada nueva = el approve de siempre (la original no se toca).
  if (parsed.data.mode === 'new') {
    return approvePlay({ id: parsed.data.id }, locale);
  }

  // (A) Sustituir la original: volcado + consumo, atómico, en la RPC.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data: result, error } = await supabase
    .rpc('replace_play_with_proposal', { p_proposal_id: parsed.data.id })
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  if (!result) return { error: 'not_found' };

  const originalId = result.original_id as string;
  const playName = (result.play_name as string | null) ?? '';
  const ownerId = result.proposal_owner_id as string;

  // Notificaciones (no bloquean la aprobación si el bus falla). Admin client para
  // resolver el staff de los equipos (la RLS de team_plays/team_staff exige ser staff
  // DEL equipo y el aprobador puede no serlo). La sustitución ya está autorizada.
  try {
    const { emitNotification, emitNotificationFanOut } = await import('@/lib/notify-bus');
    const admin = createSupabaseAdminClient();
    const deepLink = `/${locale}/jugadas/${originalId}/editar`;

    // 1) Staff de los equipos que tienen la jugada en su playbook → "actualizada".
    const { data: tps } = await admin
      .from('team_plays')
      .select('team_id')
      .eq('play_id', originalId);
    const teamIds = [...new Set((tps ?? []).map((r) => r.team_id as string))];
    let staffIds: string[] = [];
    if (teamIds.length > 0) {
      const { data: staff } = await admin
        .from('team_staff')
        .select('membership:memberships!inner(profile_id)')
        .in('team_id', teamIds)
        .is('left_at', null);
      staffIds = [
        ...new Set(
          (staff ?? [])
            .map((s) => (s.membership as { profile_id: string } | null)?.profile_id)
            .filter((p): p is string => !!p),
        ),
      ].filter((p) => p !== ctx.user.id && p !== ownerId);
    }
    if (staffIds.length > 0) {
      await emitNotificationFanOut(
        staffIds.map((user_id) => ({ user_id })),
        {
          type: 'play_updated',
          in_app_payload: { play_id: originalId, play_name: playName, deep_link: deepLink },
          push_payload: {
            title: playName,
            body: '',
            deep_link: deepLink,
            tag: `play_updated:${originalId}`,
          },
          dedupe_base_prefix: `play_updated:${originalId}:${Date.now()}`,
        },
      );
    }

    // 2) Al proponente: su propuesta se aprobó (apunta ya a la original sustituida).
    if (ownerId !== ctx.user.id) {
      await emitNotification({
        user_id: ownerId,
        type: 'play_approved',
        in_app_payload: { play_id: originalId, play_name: playName, deep_link: deepLink },
        push_payload: {
          title: playName,
          body: '',
          deep_link: deepLink,
          tag: `play_approved:${originalId}`,
        },
        dedupe_base: `play_approved:${originalId}:${Date.now()}`,
      });
    }
  } catch (notifyErr) {
    Sentry.captureException(notifyErr, {
      tags: { feature: 'plays', step: 'notify_replace' },
      extra: { play_id: originalId },
    });
  }

  revalidatePlays();
  return { success: true, id: originalId };
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
