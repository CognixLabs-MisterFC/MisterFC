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
  nextTournamentRound,
  tournamentInputSchema,
  tournamentMatchInputSchema,
  TIMEZONE_OLA1,
  zonedFields,
  type EventInput,
  type Occurrence,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type EventActionResult =
  | { success: true; event_id: string; skipped_holidays?: string[] }
  | {
      success: false;
      error:
        | 'invalid_input'
        | 'no_active_club'
        | 'forbidden'
        | 'not_found'
        | 'cross_club'
        | 'all_on_holidays'
        | 'db';
      detail?: string;
    };

/**
 * F14F-3 — clave de día local del club (Europe/Madrid) 'YYYY-MM-DD' para una
 * fecha, con el MISMO criterio que mark_holiday en BD (starts_at at time zone
 * 'Europe/Madrid')::date. zonedFields.month es 0-based.
 */
function madridDateKey(d: Date): string {
  const z = zonedFields(d, TZ);
  return `${z.year}-${String(z.month + 1).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`;
}

/**
 * F14F-3 — festivos del club que caen en el rango de las ocurrencias dadas,
 * como Set de claves 'YYYY-MM-DD'. Vacío si no hay ocurrencias.
 */
async function loadClubHolidaySet(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  clubId: string,
  occurrences: Occurrence[]
): Promise<Set<string>> {
  if (occurrences.length === 0) return new Set();
  const keys = occurrences.map((o) => madridDateKey(o.starts_at));
  const min = keys.reduce((a, b) => (a < b ? a : b));
  const max = keys.reduce((a, b) => (a > b ? a : b));
  const { data } = await supabase
    .from('holidays')
    .select('date')
    .eq('club_id', clubId)
    .gte('date', min)
    .lte('date', max);
  return new Set((data ?? []).map((h) => h.date as string));
}

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

  // F14F-3 — una SERIE de entrenamientos SALTA los días marcados como festivo
  // (instalaciones cerradas): esas ocurrencias no se crean. Se calcula ANTES de
  // insertar el parent, porque el parent es la 1ª ocurrencia: si esa cae en
  // festivo, el parent pasa a ser la 1ª ocurrencia NO festiva. Solo TRAINING;
  // los partidos y demás tipos pueden ocurrir en festivo → intactos.
  let parentStartsAt = data.starts_at;
  let parentEndsAt: string | null = data.ends_at ?? null;
  let childOccurrences: Occurrence[] = [];
  let skippedHolidays: string[] = [];

  if (data.recurrence_rule) {
    const occurrences = expandRecurrence(
      new Date(data.starts_at),
      data.ends_at ? new Date(data.ends_at) : null,
      data.recurrence_rule,
      TZ
    );
    if (data.type === 'training') {
      const holidaySet = await loadClubHolidaySet(supabase, clubId, occurrences);
      const kept: Occurrence[] = [];
      for (const occ of occurrences) {
        const key = madridDateKey(occ.starts_at);
        if (holidaySet.has(key)) skippedHolidays.push(key);
        else kept.push(occ);
      }
      // Serie entera sobre festivos: no se crea nada (caso degenerado).
      if (kept.length === 0) {
        return { success: false, error: 'all_on_holidays' };
      }
      // El parent es la 1ª ocurrencia NO festiva.
      parentStartsAt = kept[0]!.starts_at.toISOString();
      parentEndsAt = kept[0]!.ends_at ? kept[0]!.ends_at!.toISOString() : null;
      childOccurrences = kept.slice(1);
      skippedHolidays = [...new Set(skippedHolidays)].sort();
    } else {
      // Otros tipos: NO se saltan festivos. Comportamiento idéntico al previo.
      childOccurrences = occurrences.slice(1);
    }
  }

  const parentInsert = {
    club_id: clubId,
    ...targetCols,
    type: data.type,
    title: data.title,
    notes: data.notes,
    starts_at: parentStartsAt,
    ends_at: parentEndsAt,
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

  if (data.recurrence_rule && childOccurrences.length > 0) {
    const children = childOccurrences.map((occ) => ({
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

    const { error: childErr } = await supabase.from('events').insert(children);
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

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return {
    success: true,
    event_id: parent.id as string,
    skipped_holidays: skippedHolidays.length > 0 ? skippedHolidays : undefined,
  };
}

/**
 * F13B (T-1) — Alta de un TORNEO. Crea ATÓMICAMENTE (secuencia con rollback
 * manual, como createEvent con la serie) dos eventos del mismo equipo:
 *   a) la CABECERA: type='tournament', tournament_id=NULL, round=NULL. Aloja la
 *      convocatoria única del torneo (los triggers de convocatoria ya aceptan
 *      tournament). Sin opponent_name (no es un cruce).
 *   b) el 1er PARTIDO: type='match', tournament_id=cabecera.id, round=1, con el
 *      rival/lugar/fecha del 1er cruce. Su stack (alineación/directo/valoraciones)
 *      cuelga de su propio event_id sin relajar triggers (es 'match').
 * Respeta los CHECK de T-0 (round y tournament_id van juntos; el hijo es 'match').
 * NO gestiona la convocatoria aquí (eso se hace en la cabecera con el flujo
 * existente). Devuelve el id de la CABECERA.
 */
export async function createTournament(
  input: unknown
): Promise<EventActionResult> {
  const parsed = tournamentInputSchema.safeParse(input);
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

  // a) Cabecera del torneo (sin tournament_id/round → evento normal type=tournament).
  const { data: header, error: headerErr } = await supabase
    .from('events')
    .insert({
      club_id: clubId,
      team_id: data.team_id,
      category_id: null,
      type: 'tournament',
      title: data.title,
      notes: data.notes,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      all_day: data.all_day,
      location_name: data.location_name,
      location_address: data.location_address,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (headerErr || !header) {
    if (headerErr?.code === '42501') return { success: false, error: 'forbidden' };
    if (headerErr?.code === '23514') {
      return { success: false, error: 'cross_club', detail: headerErr.message };
    }
    return { success: false, error: 'db', detail: headerErr?.message };
  }

  // b) 1er partido del torneo (type=match, tournament_id + round=1 juntos).
  const { error: matchErr } = await supabase.from('events').insert({
    club_id: clubId,
    team_id: data.team_id,
    category_id: null,
    type: 'match',
    title: data.title,
    notes: null,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    all_day: data.all_day,
    location_name: data.location_name,
    location_address: data.location_address,
    opponent_name: data.opponent_name,
    tournament_id: header.id as string,
    round: 1,
    created_by: user.id,
  });

  if (matchErr) {
    // Rollback manual de la cabecera (no dejar un torneo sin partidos).
    await supabase.from('events').delete().eq('id', header.id as string);
    if (matchErr.code === '42501') return { success: false, error: 'forbidden' };
    return { success: false, error: 'db', detail: matchErr.message };
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true, event_id: header.id as string };
}

/**
 * F13B (T-4) — Añade el SIGUIENTE partido a un torneo existente (avance manual de
 * la eliminatoria). Inserta un evento `type='match'` con `tournament_id` = la
 * cabecera y `round` = max(round) + 1, heredando `club_id`/`team_id`/título de la
 * cabecera. NO crea convocatoria propia: la hereda por referencia de la cabecera
 * (T-2). El rival y el lugar son OPCIONALES (el cruce siguiente suele conocerse
 * después → editable luego con la edición de evento). Autorización: la MISMA que
 * crear un partido de ese equipo — la impone la RLS `events_insert_managers`
 * (helper `user_can_manage_event`, staff del equipo, NO memberships.role); un
 * INSERT no autorizado devuelve 42501 → 'forbidden'. Respeta los CHECK de T-0
 * (`type='match'` + `tournament_id`/`round` no nulos juntos). Devuelve el id del
 * nuevo partido.
 */
export async function addTournamentMatch(
  tournamentId: string,
  input: unknown,
): Promise<EventActionResult> {
  const parsed = tournamentMatchInputSchema.safeParse(input);
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
  const user = await getCurrentUser(adapter);
  if (!user) return { success: false, error: 'forbidden' };

  // Cabecera del torneo: debe existir, ser type='tournament' y no colgar de otro
  // torneo (tournament_id NULL). Hereda club_id/team_id/título.
  const { data: header, error: headerErr } = await supabase
    .from('events')
    .select('id, club_id, team_id, type, tournament_id, title')
    .eq('id', tournamentId)
    .maybeSingle();
  if (headerErr) return { success: false, error: 'db', detail: headerErr.message };
  if (!header) return { success: false, error: 'not_found' };
  if (header.type !== 'tournament' || header.tournament_id != null) {
    return { success: false, error: 'invalid_input', detail: 'not_a_tournament_header' };
  }
  if (header.team_id == null) {
    return { success: false, error: 'invalid_input', detail: 'tournament_without_team' };
  }

  // Ronda siguiente = max(round) + 1 de los partidos ya existentes del torneo.
  const { data: rounds, error: roundsErr } = await supabase
    .from('events')
    .select('round')
    .eq('tournament_id', tournamentId);
  if (roundsErr) return { success: false, error: 'db', detail: roundsErr.message };
  const nextRound = nextTournamentRound(
    (rounds ?? []).map((r) => r.round as number | null),
  );

  const { data: match, error: matchErr } = await supabase
    .from('events')
    .insert({
      club_id: header.club_id as string,
      team_id: header.team_id as string,
      category_id: null,
      type: 'match',
      title: header.title as string,
      notes: null,
      starts_at: data.starts_at,
      ends_at: null,
      all_day: false,
      location_name: data.location_name ?? null,
      location_address: data.location_address ?? null,
      opponent_name: data.opponent_name ?? null,
      tournament_id: tournamentId,
      round: nextRound,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (matchErr || !match) {
    if (matchErr?.code === '42501') return { success: false, error: 'forbidden' };
    if (matchErr?.code === '23514') {
      return { success: false, error: 'cross_club', detail: matchErr.message };
    }
    return { success: false, error: 'db', detail: matchErr?.message };
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true, event_id: match.id as string };
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

// ─────────────────────────────────────────────────────────────────────────────
// F14F-1 — Cancelar / descancelar un entrenamiento.
// ─────────────────────────────────────────────────────────────────────────────

type CancelErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'not_training'
  | 'already_cancelled'
  | 'not_cancelled'
  | 'cancelled_by_holiday'
  | 'no_session'
  | 'db';

export type EventCancelResult =
  | { success: true }
  | { success: false; error: CancelErrorCode };

const CANCEL_ERRORS = new Set<string>([
  'forbidden',
  'not_found',
  'not_training',
  'already_cancelled',
  'not_cancelled',
  'cancelled_by_holiday',
  'no_session',
]);

/**
 * F14F-1 — Aviso "entrenamiento cancelado" a jugadores/familias del equipo
 * (team_members → player_accounts), reusando el bus F5.7 igual que
 * event_updated. El entrenamiento cancelado NO desaparece; el aviso informa.
 */
async function notifyTrainingCancelled(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  ev: { id: string; teamId: string; title: string; startsAt: string },
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
  ) as string[];
  if (recipients.length === 0) return;

  const whenEs = new Date(ev.startsAt).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipients.map((u) => ({ user_id: u })),
    {
      type: 'training_cancelled',
      in_app_payload: {
        event_id: ev.id,
        team_id: ev.teamId,
        title: ev.title,
        starts_at: ev.startsAt,
        deep_link: '/calendario',
      },
      push_payload: {
        title: `Entrenamiento cancelado: ${ev.title}`,
        body: whenEs,
        deep_link: '/es/calendario',
        tag: `training_cancelled:${ev.id}`,
      },
      // dedupe por evento+fecha: cancelar/descancelar/cancelar del mismo día no
      // re-notifica; una cancelación de otro día (evento distinto) sí.
      dedupe_base_prefix: `training_cancelled:${ev.id}:${ev.startsAt}`,
    },
  );
}

/**
 * F14F-1b — Aviso "entrenamiento reactivado" a jugadores/familias del equipo,
 * mismo mecanismo y destinatarios que notifyTrainingCancelled. Se emite al
 * DESCANCELAR: el entrenamiento vuelve con su hora y su plan (nunca se borró ni
 * se reprograma). dedupe por evento+fecha, con prefijo distinto del de
 * cancelación para que ambos avisos convivan sobre el mismo evento.
 */
async function notifyTrainingReinstated(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  ev: { id: string; teamId: string; title: string; startsAt: string },
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
  ) as string[];
  if (recipients.length === 0) return;

  const whenEs = new Date(ev.startsAt).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipients.map((u) => ({ user_id: u })),
    {
      type: 'training_reinstated',
      in_app_payload: {
        event_id: ev.id,
        team_id: ev.teamId,
        title: ev.title,
        starts_at: ev.startsAt,
        deep_link: '/calendario',
      },
      push_payload: {
        title: `Entrenamiento reactivado: ${ev.title}`,
        body: whenEs,
        deep_link: '/es/calendario',
        tag: `training_reinstated:${ev.id}`,
      },
      dedupe_base_prefix: `training_reinstated:${ev.id}:${ev.startsAt}`,
    },
  );
}

/**
 * F14F-1 — Cancela un entrenamiento (motivo opcional) vía RPC cancel_event
 * (gate user_can_manage_event). Avisa a jugadores/familias del equipo. El
 * entrenamiento queda tachado en el calendario, NO se borra.
 */
export async function cancelTraining(
  eventId: string,
  reason: string | null,
): Promise<EventCancelResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const trimmed = reason?.trim() ? reason.trim().slice(0, 500) : null;
  const { error } = await supabase.rpc('cancel_event', {
    p_event_id: eventId,
    p_reason: trimmed ?? undefined,
  });
  if (error) {
    const code = error.message?.trim();
    if (code && CANCEL_ERRORS.has(code)) {
      return { success: false, error: code as CancelErrorCode };
    }
    return { success: false, error: 'db' };
  }

  // Aviso (best-effort; no bloquea el resultado). Necesita team_id/title/fecha.
  const { data: ev } = await supabase
    .from('events')
    .select('id, team_id, title, starts_at')
    .eq('id', eventId)
    .maybeSingle();
  if (ev?.team_id) {
    await notifyTrainingCancelled(supabase, {
      id: ev.id,
      teamId: ev.team_id,
      title: ev.title,
      startsAt: ev.starts_at,
    });
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true };
}

/**
 * F14F-1 — Reactiva (descancela) un entrenamiento cancelado por PERSONA vía RPC
 * uncancel_event. Los cancelados por FESTIVO se reactivan en F14F-2. F14F-1b:
 * avisa a jugadores/familias del equipo (el entrenamiento vuelve; caso real:
 * se levanta la alerta de lluvia). El entrenamiento no se recrea ni reprograma.
 */
export async function uncancelTraining(
  eventId: string,
): Promise<EventCancelResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('uncancel_event', {
    p_event_id: eventId,
  });
  if (error) {
    const code = error.message?.trim();
    if (code && CANCEL_ERRORS.has(code)) {
      return { success: false, error: code as CancelErrorCode };
    }
    return { success: false, error: 'db' };
  }

  // Aviso (best-effort; no bloquea el resultado). El evento ya está activo.
  const { data: ev } = await supabase
    .from('events')
    .select('id, team_id, title, starts_at')
    .eq('id', eventId)
    .maybeSingle();
  if (ev?.team_id) {
    await notifyTrainingReinstated(supabase, {
      id: ev.id,
      teamId: ev.team_id,
      title: ev.title,
      startsAt: ev.starts_at,
    });
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// F14F-2 — Marcar / desmarcar DÍA FESTIVO (club entero). Solo dirección/admin
// (el gate real vive en las RPCs mark_holiday/unmark_holiday). Reutiliza el estado
// de cancelación de F14F-1: los entrenamientos del día pasan a source='holiday'.
// ─────────────────────────────────────────────────────────────────────────────

type HolidayErrorCode =
  | 'forbidden'
  | 'no_session'
  | 'already_holiday'
  | 'reason_required'
  | 'not_found'
  | 'db';

export type HolidayActionResult =
  | { success: true; holidayId: string }
  | { success: false; error: HolidayErrorCode };

const HOLIDAY_ERRORS = new Set<string>([
  'forbidden',
  'no_session',
  'already_holiday',
  'reason_required',
  'not_found',
]);

type AffectedEvent = {
  event_id: string;
  team_id: string | null;
  title: string;
  starts_at: string;
};

/**
 * F14F-2 — destinatarios del aviso de festivo para un equipo: ENTRENADORES
 * (team_staff activo → memberships) ∪ JUGADORES/FAMILIAS (team_members activo →
 * player_accounts). Deduplicado por profile_id. A diferencia de F14F-1, el
 * festivo lo marca dirección, así que TAMBIÉN se avisa a los entrenadores.
 */
async function holidayTeamRecipients(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  teamId: string,
): Promise<string[]> {
  const [{ data: staffRows }, { data: tms }] = await Promise.all([
    supabase
      .from('team_staff')
      .select('memberships!inner(profile_id)')
      .eq('team_id', teamId)
      .is('left_at', null),
    supabase
      .from('team_members')
      .select('player_id')
      .eq('team_id', teamId)
      .is('left_at', null),
  ]);

  const coachIds = ((staffRows ?? []) as unknown as {
    memberships: { profile_id: string };
  }[]).map((r) => r.memberships.profile_id);

  const playerIds = (tms ?? []).map((r) => r.player_id);
  let familyIds: string[] = [];
  if (playerIds.length > 0) {
    const { data: pas } = await supabase
      .from('player_accounts')
      .select('profile_id')
      .in('player_id', playerIds);
    familyIds = (pas ?? []).map((r) => r.profile_id).filter(Boolean) as string[];
  }

  return Array.from(new Set([...coachIds, ...familyIds]));
}

/**
 * F14F-2 — emite el aviso (cancelación o reactivación por festivo) a los
 * destinatarios de cada equipo afectado. Reutiliza los tipos de F14F-1
 * (training_cancelled / training_reinstated); el motivo del festivo viaja en el
 * cuerpo del push. best-effort: no bloquea el resultado de la acción.
 */
async function notifyHolidayEvents(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  events: AffectedEvent[],
  kind: 'cancelled' | 'reinstated',
  reason: string | null,
): Promise<void> {
  const withTeam = events.filter((e) => e.team_id);
  if (withTeam.length === 0) return;

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  const type = kind === 'cancelled' ? 'training_cancelled' : 'training_reinstated';

  for (const ev of withTeam) {
    const recipients = await holidayTeamRecipients(supabase, ev.team_id as string);
    if (recipients.length === 0) continue;

    const whenEs = new Date(ev.starts_at).toLocaleString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    });
    const pushTitle =
      kind === 'cancelled'
        ? `Entrenamiento cancelado: ${ev.title}`
        : `Entrenamiento reactivado: ${ev.title}`;
    const pushBody =
      kind === 'cancelled' && reason
        ? `Instalaciones cerradas (${reason}) · ${whenEs}`
        : whenEs;

    await emitNotificationFanOut(
      recipients.map((u) => ({ user_id: u })),
      {
        type,
        in_app_payload: {
          event_id: ev.event_id,
          team_id: ev.team_id,
          title: ev.title,
          starts_at: ev.starts_at,
          deep_link: '/calendario',
        },
        push_payload: {
          title: pushTitle,
          body: pushBody,
          deep_link: '/es/calendario',
          tag: `${type}:${ev.event_id}`,
        },
        dedupe_base_prefix: `${type}:${ev.event_id}:${ev.starts_at}`,
      },
    );
  }
}

/**
 * F14F-2 — Marca un día como festivo del club activo vía RPC mark_holiday
 * (gate admin/director dentro de la RPC). Cancela atómicamente los
 * entrenamientos ACTIVOS de ese día y avisa a entrenadores/jugadores/familias.
 * `date` en formato ISO 'YYYY-MM-DD' (día del club, Europe/Madrid).
 */
export async function markHoliday(
  date: string,
  reason: string,
): Promise<HolidayActionResult> {
  const clubId = await getActiveClubId();
  if (!clubId) return { success: false, error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data, error } = await supabase.rpc('mark_holiday', {
    p_club_id: clubId,
    p_date: date,
    p_reason: reason,
  });
  if (error) {
    const code = error.message?.trim();
    if (code && HOLIDAY_ERRORS.has(code)) {
      return { success: false, error: code as HolidayErrorCode };
    }
    return { success: false, error: 'db' };
  }

  const result = (data ?? {}) as {
    holiday_id?: string;
    reason?: string;
    cancelled?: AffectedEvent[];
  };
  const cancelled = result.cancelled ?? [];
  if (cancelled.length > 0) {
    await notifyHolidayEvents(supabase, cancelled, 'cancelled', result.reason ?? reason);
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true, holidayId: result.holiday_id ?? '' };
}

/**
 * F14F-2 — Desmarca un festivo vía RPC unmark_holiday: reactiva SOLO los
 * entrenamientos que canceló ESE festivo (los de persona no se tocan) y avisa
 * de la reactivación.
 */
export async function unmarkHoliday(
  holidayId: string,
): Promise<HolidayActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data, error } = await supabase.rpc('unmark_holiday', {
    p_holiday_id: holidayId,
  });
  if (error) {
    const code = error.message?.trim();
    if (code && HOLIDAY_ERRORS.has(code)) {
      return { success: false, error: code as HolidayErrorCode };
    }
    return { success: false, error: 'db' };
  }

  const result = (data ?? {}) as { reactivated?: AffectedEvent[] };
  const reactivated = result.reactivated ?? [];
  if (reactivated.length > 0) {
    await notifyHolidayEvents(supabase, reactivated, 'reinstated', null);
  }

  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true, holidayId };
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
