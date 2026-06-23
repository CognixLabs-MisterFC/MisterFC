'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  createSupabaseServerClient,
  eventInputSchema,
  expandRecurrence,
  getCurrentUser,
  getCurrentUserClubs,
  resolveActiveClub,
  TIMEZONE_OLA1,
  type EventInput,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type EventActionResult =
  | { success: true; event_id: string }
  | {
      success: false;
      error:
        | 'invalid_input'
        | 'no_active_club'
        | 'forbidden'
        | 'not_found'
        | 'cross_club'
        | 'db';
      detail?: string;
    };

export type EventDeleteResult =
  | { success: true; deleted_count: number }
  | {
      success: false;
      error: 'forbidden' | 'not_found' | 'invalid_mode' | 'db';
    };

const TZ = TIMEZONE_OLA1;

async function getActiveClubId(): Promise<string | null> {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length === 0) return null;
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null;
  const { active } = resolveActiveClub(clubs, cookieValue);
  return active?.club.id ?? null;
}

/**
 * INSERT del parent + (si hay regla) N hijos.
 * Transacción manual via RPC NO disponible; estrategia:
 *   1) INSERT parent y obtener id.
 *   2) Generar children con expandRecurrence (saltando el primero, que es el parent).
 *   3) Bulk INSERT de children. Si falla, DELETE parent → rollback manual.
 */
export async function createEvent(
  input: EventInput
): Promise<EventActionResult> {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'invalid_input',
      detail: parsed.error.issues[0]?.message,
    };
  }
  const data = parsed.data;

  const clubId = await getActiveClubId();
  if (!clubId) return { success: false, error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const user = await getCurrentUser(adapter);
  if (!user) return { success: false, error: 'forbidden' };

  const targetCols = targetToColumns(data.target);

  const parentInsert = {
    club_id: clubId,
    ...targetCols,
    type: data.type,
    title: data.title,
    notes: data.notes,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    all_day: data.all_day,
    location_name: data.location_name,
    location_address: data.location_address,
    opponent_name: data.opponent_name,
    recurrence_rule: data.recurrence_rule,
    created_by: user.id,
  };

  const { data: parent, error: parentErr } = await supabase
    .from('events')
    .insert(parentInsert)
    .select('id')
    .single();

  if (parentErr || !parent) {
    if (parentErr?.code === '42501') {
      return { success: false, error: 'forbidden' };
    }
    if (parentErr?.code === '23514') {
      return {
        success: false,
        error: 'cross_club',
        detail: parentErr.message,
      };
    }
    return {
      success: false,
      error: 'db',
      detail: parentErr?.message,
    };
  }

  if (data.recurrence_rule) {
    const occurrences = expandRecurrence(
      new Date(data.starts_at),
      data.ends_at ? new Date(data.ends_at) : null,
      data.recurrence_rule,
      TZ
    );
    // El primero es el parent; los siguientes son children.
    const children = occurrences.slice(1).map((occ) => ({
      club_id: clubId,
      ...targetCols,
      type: data.type,
      title: data.title,
      notes: data.notes,
      starts_at: occ.starts_at.toISOString(),
      ends_at: occ.ends_at ? occ.ends_at.toISOString() : null,
      all_day: data.all_day,
      location_name: data.location_name,
      location_address: data.location_address,
      opponent_name: data.opponent_name,
      parent_event_id: parent.id,
      created_by: user.id,
    }));

    if (children.length > 0) {
      const { error: childErr } = await supabase
        .from('events')
        .insert(children);
      if (childErr) {
        // Rollback manual del parent.
        await supabase.from('events').delete().eq('id', parent.id);
        return {
          success: false,
          error: 'db',
          detail: childErr.message,
        };
      }
    }
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true, event_id: parent.id as string };
}

/**
 * UPDATE de un evento. Modos:
 *   - single: solo este evento (children o aislado).
 *   - this_and_future: este + descendientes con starts_at >= esta_fecha.
 *     Para parents, equivale a "toda la serie" (no se distingue desde el parent).
 *   - series: el parent + todos los children.
 *
 * No regenera la serie: la lógica de "borrar futuros y regenerar" se reserva
 * para cambios estructurales (cambio de día/hora/regla) que F3 NO soporta en
 * edición; la edición actual solo toca metadatos (título, type, lugar, notes).
 */
export async function updateEvent(
  eventId: string,
  mode: 'single' | 'this_and_future' | 'series',
  input: EventInput
): Promise<EventActionResult> {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'invalid_input',
      detail: parsed.error.issues[0]?.message,
    };
  }
  const data = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: existing } = await supabase
    .from('events')
    .select(
      'id, type, team_id, starts_at, ends_at, location_name, location_address, parent_event_id',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!existing) return { success: false, error: 'not_found' };

  const editor = await getCurrentUser(adapter);
  const targetCols = targetToColumns(data.target);

  const patch = {
    ...targetCols,
    type: data.type,
    title: data.title,
    notes: data.notes,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    all_day: data.all_day,
    location_name: data.location_name,
    location_address: data.location_address,
    opponent_name: data.opponent_name,
  };

  if (mode === 'single') {
    const { error } = await supabase
      .from('events')
      .update(patch)
      .eq('id', eventId);
    if (error) {
      if (error.code === '42501') {
        return { success: false, error: 'forbidden' };
      }
      return { success: false, error: 'db', detail: error.message };
    }
  } else {
    // Patch SIN starts_at/ends_at (modificar el horario de todos crearía conflicts).
    const groupPatch = {
      ...targetCols,
      type: data.type,
      title: data.title,
      notes: data.notes,
      all_day: data.all_day,
      location_name: data.location_name,
      location_address: data.location_address,
      opponent_name: data.opponent_name,
    };
    const parentId =
      (existing.parent_event_id as string | null) ?? (existing.id as string);
    let query = supabase
      .from('events')
      .update(groupPatch)
      .or(`id.eq.${parentId},parent_event_id.eq.${parentId}`);
    if (mode === 'this_and_future') {
      query = query.gte('starts_at', existing.starts_at as string);
    }
    const { error } = await query;
    if (error) {
      if (error.code === '42501') {
        return { success: false, error: 'forbidden' };
      }
      return { success: false, error: 'db', detail: error.message };
    }
  }

  // F13.9c — avisa a jugadores/familias del equipo si cambia horario o lugar de
  // un ENTRENAMIENTO. El horario solo se aplica en modo 'single' (los modos de
  // serie no tocan starts_at/ends_at); el lugar se aplica en todos los modos.
  // Los partidos ya tienen su propio flujo (callup_updated) → aquí solo training.
  const isTraining = existing.type === 'training';
  const sameInstant = (a: string | null, b: string | null): boolean =>
    (a == null ? null : new Date(a).getTime()) === (b == null ? null : new Date(b).getTime());
  const dateTimeChanged =
    mode === 'single' &&
    (!sameInstant(data.starts_at, existing.starts_at as string | null) ||
      !sameInstant(data.ends_at ?? null, existing.ends_at as string | null));
  const locationChanged =
    (data.location_name ?? null) !== (existing.location_name as string | null) ||
    (data.location_address ?? null) !== (existing.location_address as string | null);

  if (isTraining && existing.team_id && (dateTimeChanged || locationChanged)) {
    // El horario notificado es el realmente aplicado (en modos de serie se
    // mantiene el existente). No bloquea el guardado si el bus falla.
    const effectiveStartsAt =
      mode === 'single' ? data.starts_at : (existing.starts_at as string);
    try {
      await notifyEventUpdated(supabase, {
        id: eventId,
        teamId: existing.team_id as string,
        title: data.title,
        startsAt: effectiveStartsAt,
        locationName: data.location_name ?? null,
        editorId: editor?.id ?? null,
      });
    } catch {
      // best-effort; el evento ya se guardó.
    }
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true, event_id: eventId };
}

/**
 * F13.9c — fan-out de "entrenamiento actualizado" a jugadores/familias del
 * equipo (team_members → player_accounts), reusando el bus F5.7 igual que
 * play_published/callup. Excluye al editor. dedupe por el contenido del cambio
 * (horario+lugar) → re-guardar lo mismo no duplica, un cambio real sí notifica.
 * El texto in_app del feed lo construye el mapper (13.9a) en el idioma del
 * lector; el push va en es (como callup/recordatorios).
 */
async function notifyEventUpdated(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  ev: {
    id: string;
    teamId: string;
    title: string;
    startsAt: string;
    locationName: string | null;
    editorId: string | null;
  },
): Promise<void> {
  const { data: tms } = await supabase
    .from('team_members')
    .select('player_id')
    .eq('team_id', ev.teamId)
    .is('left_at', null);
  const playerIds = (tms ?? []).map((r) => r.player_id);
  if (playerIds.length === 0) return;

  const { data: pas } = await supabase
    .from('player_accounts')
    .select('profile_id')
    .in('player_id', playerIds);
  const recipients = Array.from(
    new Set((pas ?? []).map((r) => r.profile_id).filter(Boolean)),
  ).filter((u) => u !== ev.editorId) as string[];
  if (recipients.length === 0) return;

  const whenEs = new Date(ev.startsAt).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
  const title = `Entrenamiento actualizado: ${ev.title}`;
  const body = ev.locationName ? `${whenEs} · ${ev.locationName}` : whenEs;
  const changeToken = `${ev.startsAt}|${ev.locationName ?? ''}`;

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipients.map((u) => ({ user_id: u })),
    {
      type: 'event_updated',
      in_app_payload: {
        event_id: ev.id,
        team_id: ev.teamId,
        title: ev.title,
        starts_at: ev.startsAt,
        deep_link: '/calendario',
      },
      push_payload: {
        title,
        body,
        deep_link: '/es/calendario',
        tag: `event_updated:${ev.id}`,
      },
      dedupe_base_prefix: `event_updated:${ev.id}:${changeToken}`,
    },
  );
}

/**
 * DELETE de un evento.
 *   - single: borra solo esa fila.
 *   - this_and_future: borra esta + todos los hermanos con starts_at >= esta.
 *   - series: borra parent → cascade borra todos los children.
 */
export async function deleteEvent(
  eventId: string,
  mode: 'single' | 'this_and_future' | 'series'
): Promise<EventDeleteResult> {
  if (
    mode !== 'single' &&
    mode !== 'this_and_future' &&
    mode !== 'series'
  ) {
    return { success: false, error: 'invalid_mode' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: existing } = await supabase
    .from('events')
    .select('id, starts_at, parent_event_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!existing) return { success: false, error: 'not_found' };

  let deletedCount = 0;

  if (mode === 'single') {
    const { error, count } = await supabase
      .from('events')
      .delete({ count: 'exact' })
      .eq('id', eventId);
    if (error) {
      if (error.code === '42501') {
        return { success: false, error: 'forbidden' };
      }
      return { success: false, error: 'db' };
    }
    deletedCount = count ?? 0;
  } else if (mode === 'this_and_future') {
    const parentId =
      (existing.parent_event_id as string | null) ?? (existing.id as string);
    // Borra este id + cualquier hermano (parent_event_id=parentId) con
    // starts_at >= esta_fecha. Si el evento es el parent, también se borra.
    const startCutoff = existing.starts_at as string;
    const { error: e1, count: c1 } = await supabase
      .from('events')
      .delete({ count: 'exact' })
      .gte('starts_at', startCutoff)
      .or(`id.eq.${parentId},parent_event_id.eq.${parentId}`);
    if (e1) {
      if (e1.code === '42501') {
        return { success: false, error: 'forbidden' };
      }
      return { success: false, error: 'db' };
    }
    deletedCount = c1 ?? 0;
  } else {
    // series
    const parentId =
      (existing.parent_event_id as string | null) ?? (existing.id as string);
    const { error, count } = await supabase
      .from('events')
      .delete({ count: 'exact' })
      .eq('id', parentId); // cascade borra children
    if (error) {
      if (error.code === '42501') {
        return { success: false, error: 'forbidden' };
      }
      return { success: false, error: 'db' };
    }
    deletedCount = count ?? 0;
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true, deleted_count: deletedCount };
}

function targetToColumns(target: EventInput['target']): {
  team_id: string | null;
  category_id: string | null;
} {
  if (target.kind === 'team') {
    return { team_id: target.team_id, category_id: null };
  }
  if (target.kind === 'category') {
    return { team_id: null, category_id: target.category_id };
  }
  return { team_id: null, category_id: null };
}
