'use server';

import { revalidatePath } from 'next/cache';
import {
  calledUpLimitApplies,
  calledUpOverflow,
  createSupabaseAdminClient,
  createSupabaseServerClient,
  maxCalledUpFor,
  publishCallupSchema,
  upsertCallupDecisionSchema,
  upsertCallupResponseSchema,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type SupaClient = ReturnType<typeof createSupabaseServerClient>;

/**
 * F6 Mejora 3 — devuelve un estado de error si el nº de convocados (roster a
 * fecha del partido − descartados en callup_decisions) excede el máximo de la
 * modalidad del equipo. null si cabe. "Convocados" = los que el coach lleva,
 * no los que respondieron "no" (esos son no-disponibles por respuesta propia).
 */
async function checkCalledUpLimit(
  supabase: SupaClient,
  eventId: string
): Promise<PublishCallupState | null> {
  const { data: ev } = await supabase
    .from('events')
    .select('type, team_id, starts_at, teams!inner(format)')
    .eq('id', eventId)
    .maybeSingle();
  const teamId = (ev?.team_id as string | null) ?? null;
  if (!ev || !teamId) return null;

  // F13B — el tope de convocados (regla reglamentaria por modalidad) solo aplica
  // al partido OFICIAL. Un amistoso/torneo se convoca sin límite: saltamos el
  // chequeo, que cubre publishCallup y republishCallup de una sola vez.
  if (!calledUpLimitApplies(ev.type as string)) return null;

  const format = (ev as unknown as { teams: { format: TeamFormat } }).teams
    .format;
  const eventDate = (ev.starts_at as string).slice(0, 10);

  const { data: tms } = await supabase
    .from('team_members')
    .select('player_id, joined_at, left_at')
    .eq('team_id', teamId)
    .lte('joined_at', eventDate);
  type TM = { player_id: string; joined_at: string; left_at: string | null };
  const rosterIds = (tms ?? [])
    .map((r) => r as unknown as TM)
    .filter((r) => r.left_at == null || r.left_at >= eventDate)
    .map((r) => r.player_id);

  const { data: decs } = await supabase
    .from('callup_decisions')
    .select('player_id, decision')
    .eq('event_id', eventId);
  const discarded = new Set(
    (decs ?? [])
      .filter((d) => (d.decision as string) === 'discarded')
      .map((d) => d.player_id as string)
  );
  const calledUp = rosterIds.filter((id) => !discarded.has(id)).length;

  const overflow = calledUpOverflow(calledUp, format);
  if (overflow > 0) {
    return {
      error: 'too_many_called_up',
      overflow,
      maxCalledUp: maxCalledUpFor(format),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// publishCallup (F4.4)
//
// Guarda o publica los datos de citación para un partido. Si `publish=true`
// y la fila no existía publicada, se setea published_at = now() (el trigger
// de BD valida y fuerza published_by = auth.uid()).
//
// No usamos `.upsert()` por la lección del PR #19 (INSERT ON CONFLICT
// evalúa policy INSERT WITH CHECK incluso en path UPDATE). Detección
// manual existing → UPDATE / falta → INSERT.
// ─────────────────────────────────────────────────────────────────────────────

export type PublishCallupState = {
  error?:
    | 'event_invalid'
    | 'meeting_at_invalid'
    | 'meeting_location_required'
    | 'meeting_location_too_long'
    | 'meeting_address_too_long'
    | 'transport_mode_invalid'
    | 'transport_notes_too_long'
    | 'notes_general_too_long'
    | 'event_not_match'
    | 'event_without_team'
    | 'cannot_unpublish'
    | 'too_many_called_up'
    | 'forbidden'
    | 'generic';
  success?: boolean;
  published?: boolean;
  /** Sobrante de convocados sobre el máximo de la modalidad (F6 Mejora 3). */
  overflow?: number;
  /** Máximo de convocados de la modalidad (para el mensaje). */
  maxCalledUp?: number;
};

function mapPublishErr(
  code: string | undefined
): PublishCallupState['error'] {
  const known = [
    'event_invalid',
    'meeting_at_invalid',
    'meeting_location_required',
    'meeting_location_too_long',
    'meeting_address_too_long',
    'transport_mode_invalid',
    'transport_notes_too_long',
    'notes_general_too_long',
  ] as const;
  if (code && (known as readonly string[]).includes(code)) {
    return code as PublishCallupState['error'];
  }
  return 'generic';
}

function mapPublishPgErr(
  message: string | undefined,
  pgcode: string | undefined
): PublishCallupState['error'] {
  if (pgcode === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'event_not_match';
  if (message.includes('event_without_team')) return 'event_without_team';
  if (message.includes('cannot_unpublish')) return 'cannot_unpublish';
  return 'generic';
}

export async function publishCallup(
  input: unknown
): Promise<PublishCallupState> {
  const parsed = publishCallupSchema.safeParse(input);
  if (!parsed.success) {
    return { error: mapPublishErr(parsed.error.issues[0]?.message) };
  }

  const {
    event_id,
    meeting_at,
    meeting_location,
    meeting_address,
    transport_mode,
    transport_notes,
    notes_general,
    publish,
  } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // ¿Existe ya la meta?
  const { data: existing } = await supabase
    .from('match_callup_meta')
    .select('event_id, published_at')
    .eq('event_id', event_id)
    .maybeSingle();

  // F6 Mejora 3 — al PUBLICAR (transición a publicada), bloquear si el nº de
  // convocados (roster a fecha − descartados) excede el máximo de la modalidad.
  if (publish && existing?.published_at == null) {
    const gate = await checkCalledUpLimit(supabase, event_id);
    if (gate) return gate;
  }

  const payloadCommon = {
    meeting_at,
    meeting_location,
    meeting_address,
    transport_mode,
    transport_notes,
    notes_general,
  };
  const publishedNow = publish ? new Date().toISOString() : null;

  if (existing) {
    const update =
      publish && existing.published_at == null
        ? { ...payloadCommon, published_at: publishedNow }
        : payloadCommon;
    const { error } = await supabase
      .from('match_callup_meta')
      .update(update)
      .eq('event_id', event_id);
    if (error) return { error: mapPublishPgErr(error.message, error.code) };
  } else {
    const { error } = await supabase.from('match_callup_meta').insert({
      event_id,
      ...payloadCommon,
      published_at: publishedNow,
    });
    if (error) return { error: mapPublishPgErr(error.message, error.code) };
  }

  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${event_id}`,
    'page'
  );
  revalidatePath(`/[locale]/(authenticated)/calendario`, 'page');
  const finalPublished =
    publish || existing?.published_at != null;

  // F5.7 — Notificación callup_published al jugador / familia cuando se
  // publica por primera vez (transition pending → published). Se omite si
  // era un re-save de borrador o si ya estaba publicada.
  const isFirstPublish = publish && (existing?.published_at == null);
  if (isFirstPublish) {
    try {
      await notifyCallup(event_id, 'callup_published');
    } catch (e) {
      // No bloquear el publish por fallo de notificación.
      console.error('notify callup_published error', e);
    }
  }

  return { success: true, published: !!finalPublished };
}

// ─────────────────────────────────────────────────────────────────────────────
// republishCallup (Bug G) — re-publica una convocatoria ya publicada tras
// cambios del cuerpo técnico, notificando a jugadores/familias (callup_updated).
// Permitido hasta events.starts_at. Re-aplica el tope de convocados por modalidad.
// ─────────────────────────────────────────────────────────────────────────────

export type RepublishState = {
  error?:
    | 'not_found'
    | 'not_published'
    | 'event_started'
    | 'too_many_called_up'
    | 'forbidden'
    | 'generic';
  success?: boolean;
  overflow?: number;
  maxCalledUp?: number;
};

export async function republishCallup(eventId: string): Promise<RepublishState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: meta } = await supabase
    .from('match_callup_meta')
    .select('published_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (!meta) return { error: 'not_found' };
  if (meta.published_at == null) return { error: 'not_published' };

  // No re-publicar un partido ya empezado.
  const { data: ev } = await supabase
    .from('events')
    .select('starts_at')
    .eq('id', eventId)
    .maybeSingle();
  if (ev?.starts_at && new Date(ev.starts_at).getTime() < Date.now()) {
    return { error: 'event_started' };
  }

  // Re-aplica el tope de convocados de la modalidad antes de re-publicar.
  const gate = await checkCalledUpLimit(supabase, eventId);
  if (gate) {
    return {
      error: 'too_many_called_up',
      overflow: gate.overflow,
      maxCalledUp: gate.maxCalledUp,
    };
  }

  const { error } = await supabase
    .from('match_callup_meta')
    .update({ published_at: new Date().toISOString() })
    .eq('event_id', eventId);
  if (error) {
    return { error: error.code === '42501' ? 'forbidden' : 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
  revalidatePath(`/[locale]/(authenticated)/convocatorias/${eventId}`, 'page');
  revalidatePath('/[locale]/(authenticated)/calendario', 'page');

  try {
    await notifyCallup(eventId, 'callup_updated', String(Date.now()));
  } catch (e) {
    console.error('notify callup_updated error', e);
  }

  return { success: true };
}

type CallupEvent = {
  id: string;
  team_id: string;
  title: string;
  opponent_name: string | null;
  starts_at: string;
};

/**
 * Destinatarios de una notificación de convocatoria: profiles vinculados (vía
 * player_accounts) a jugadores del roster activo a la fecha del partido.
 */
async function callupRecipients(
  eventId: string,
): Promise<{ event: CallupEvent; userIds: string[] } | null> {
  // Admin client (service role): la resolución de destinatarios NO debe quedar
  // limitada por la RLS del cuerpo técnico sobre player_accounts (Bug CC: si el
  // coach no veía las cuentas vinculadas, no se generaba ninguna notificación).
  const admin = createSupabaseAdminClient();

  const { data: event } = await admin
    .from('events')
    .select('id, team_id, title, opponent_name, starts_at')
    .eq('id', eventId)
    .maybeSingle();
  if (!event?.team_id) return null;

  const eventDate = event.starts_at.slice(0, 10);
  const { data: tms } = await admin
    .from('team_members')
    .select('player_id, joined_at, left_at')
    .eq('team_id', event.team_id)
    .lte('joined_at', eventDate);
  type TM = { player_id: string; joined_at: string; left_at: string | null };
  const rosterIds = (tms ?? [])
    .map((r) => r as unknown as TM)
    .filter((r) => r.left_at == null || r.left_at >= eventDate)
    .map((r) => r.player_id);

  // D2.1 — los jugadores SUBIDOS a este evento cuentan como convocados → reciben
  // la notificación nativa de convocatoria como un miembro más.
  const { data: promo } = await admin
    .from('player_promotions')
    .select('player_id')
    .eq('event_id', eventId);
  const allPlayerIds = Array.from(
    new Set([...rosterIds, ...((promo ?? []).map((r) => r.player_id))]),
  );
  if (allPlayerIds.length === 0) return null;

  const { data: pas } = await admin
    .from('player_accounts')
    .select('profile_id')
    .in('player_id', allPlayerIds);
  const userIds = Array.from(
    new Set((pas ?? []).map((r) => r.profile_id).filter(Boolean)),
  ) as string[];
  if (userIds.length === 0) return null;

  return { event: event as CallupEvent, userIds };
}

/**
 * Emite la notificación de convocatoria publicada (`callup_published`) o
 * actualizada (`callup_updated`, Bug D/G). `dedupeToken` distingue cada
 * publicación: en re-publicaciones se pasa un token único para que la
 * notificación NO quede deduplicada con la anterior.
 */
async function notifyCallup(
  eventId: string,
  kind: 'callup_published' | 'callup_updated',
  dedupeToken?: string,
): Promise<void> {
  const r = await callupRecipients(eventId);
  if (!r) return;
  const { event, userIds } = r;

  const oppLabel = event.opponent_name ?? '';
  const matchLabel = oppLabel ? `${event.title} vs ${oppLabel}` : event.title;
  const prefixEs =
    kind === 'callup_updated' ? 'Convocatoria actualizada' : 'Convocatoria';
  const title = `${prefixEs}: ${matchLabel}`;
  const body = `Partido el ${new Date(event.starts_at).toLocaleString('es-ES')}`;
  const base = dedupeToken
    ? `${kind}:${eventId}:${dedupeToken}`
    : `${kind}:${eventId}`;

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    userIds.map((u) => ({ user_id: u })),
    {
      type: kind,
      in_app_payload: {
        event_id: eventId,
        deep_link: `/es/convocatorias/${eventId}`,
      },
      push_payload: {
        title,
        body,
        deep_link: `/es/convocatorias/${eventId}`,
        tag: `${kind}:${eventId}`,
      },
      dedupe_base_prefix: base,
    },
  );
}

/**
 * PART 2.4 — sincroniza la convocatoria HACIA las alineaciones del partido.
 * Descartar → quita al jugador de lineup_positions de TODAS las alineaciones.
 * Convocar → lo añade al banquillo de todas las que no lo tengan. Best-effort:
 * un fallo aquí no debe romper la decisión de convocatoria.
 */
async function syncLineupsForDecision(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  eventId: string,
  playerId: string,
  calledUp: boolean,
): Promise<void> {
  const { data: lus } = await supabase
    .from('lineups')
    .select('id')
    .eq('event_id', eventId);
  const lineupIds = (lus ?? []).map((l) => l.id as string);
  if (lineupIds.length === 0) return;

  if (!calledUp) {
    await supabase
      .from('lineup_positions')
      .delete()
      .in('lineup_id', lineupIds)
      .eq('player_id', playerId);
    return;
  }

  const { data: present } = await supabase
    .from('lineup_positions')
    .select('lineup_id')
    .eq('player_id', playerId)
    .in('lineup_id', lineupIds);
  const have = new Set((present ?? []).map((r) => r.lineup_id as string));
  const missing = lineupIds.filter((id) => !have.has(id));
  if (missing.length > 0) {
    await supabase.from('lineup_positions').insert(
      missing.map((lid) => ({
        lineup_id: lid,
        player_id: playerId,
        location: 'bench' as const,
      })),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertCallupResponse (F4.5) — jugador / familia
// ─────────────────────────────────────────────────────────────────────────────

export type UpsertResponseState = {
  error?:
    | 'event_invalid'
    | 'player_invalid'
    | 'status_invalid'
    | 'reason_too_long'
    | 'event_not_match'
    | 'callup_not_published'
    | 'player_not_in_team_at_event'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

function mapUpsertResponseErr(
  code: string | undefined
): UpsertResponseState['error'] {
  const known = [
    'event_invalid',
    'player_invalid',
    'status_invalid',
    'reason_too_long',
  ] as const;
  if (code && (known as readonly string[]).includes(code)) {
    return code as UpsertResponseState['error'];
  }
  return 'generic';
}

function mapUpsertResponsePgErr(
  message: string | undefined,
  pgcode: string | undefined
): UpsertResponseState['error'] {
  if (pgcode === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'event_not_match';
  if (message.includes('callup_not_published')) return 'callup_not_published';
  if (message.includes('player_not_in_team_at_event'))
    return 'player_not_in_team_at_event';
  return 'generic';
}

export async function upsertCallupResponse(
  input: unknown
): Promise<UpsertResponseState> {
  const parsed = upsertCallupResponseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: mapUpsertResponseErr(parsed.error.issues[0]?.message) };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: existing } = await supabase
    .from('callup_responses')
    .select('id')
    .eq('event_id', parsed.data.event_id)
    .eq('player_id', parsed.data.player_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('callup_responses')
      .update({
        status: parsed.data.status,
        reason: parsed.data.reason,
      })
      .eq('id', existing.id as string);
    if (error)
      return { error: mapUpsertResponsePgErr(error.message, error.code) };
  } else {
    const { error } = await supabase.from('callup_responses').insert({
      event_id: parsed.data.event_id,
      player_id: parsed.data.player_id,
      status: parsed.data.status,
      reason: parsed.data.reason,
      responded_by: user.id,
    });
    if (error)
      return { error: mapUpsertResponsePgErr(error.message, error.code) };
  }

  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${parsed.data.event_id}`,
    'page'
  );
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertCallupDecision (F4.6) — cuerpo técnico
// ─────────────────────────────────────────────────────────────────────────────

export type UpsertDecisionState = {
  error?:
    | 'event_invalid'
    | 'player_invalid'
    | 'decision_invalid'
    | 'reason_too_long'
    | 'event_not_match'
    | 'player_not_in_team_at_event'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

function mapDecisionErr(
  code: string | undefined
): UpsertDecisionState['error'] {
  const known = [
    'event_invalid',
    'player_invalid',
    'decision_invalid',
    'reason_too_long',
  ] as const;
  if (code && (known as readonly string[]).includes(code)) {
    return code as UpsertDecisionState['error'];
  }
  return 'generic';
}

function mapDecisionPgErr(
  message: string | undefined,
  pgcode: string | undefined
): UpsertDecisionState['error'] {
  if (pgcode === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'event_not_match';
  if (message.includes('player_not_in_team_at_event'))
    return 'player_not_in_team_at_event';
  return 'generic';
}

export async function upsertCallupDecision(
  input: unknown
): Promise<UpsertDecisionState> {
  const parsed = upsertCallupDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: mapDecisionErr(parsed.error.issues[0]?.message) };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { data: existing } = await supabase
    .from('callup_decisions')
    .select('event_id')
    .eq('event_id', parsed.data.event_id)
    .eq('player_id', parsed.data.player_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('callup_decisions')
      .update({
        decision: parsed.data.decision,
        reason: parsed.data.reason,
      })
      .eq('event_id', parsed.data.event_id)
      .eq('player_id', parsed.data.player_id);
    if (error) return { error: mapDecisionPgErr(error.message, error.code) };
  } else {
    const { error } = await supabase.from('callup_decisions').insert({
      event_id: parsed.data.event_id,
      player_id: parsed.data.player_id,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      decided_by: user.id,
    });
    if (error) return { error: mapDecisionPgErr(error.message, error.code) };
  }

  // PART 2.4 — propaga el descarte/convocatoria a las alineaciones del partido.
  try {
    await syncLineupsForDecision(
      supabase,
      parsed.data.event_id,
      parsed.data.player_id,
      parsed.data.decision === 'called_up',
    );
  } catch (e) {
    console.error('syncLineupsForDecision error', e);
  }

  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${parsed.data.event_id}`,
    'page'
  );
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${parsed.data.event_id}/alineacion`,
    'page'
  );
  return { success: true };
}

export type ClearDecisionState = {
  error?: 'forbidden' | 'generic';
  success?: boolean;
};

export async function clearCallupDecision(
  eventId: string,
  playerId: string
): Promise<ClearDecisionState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { error } = await supabase
    .from('callup_decisions')
    .delete()
    .eq('event_id', eventId)
    .eq('player_id', playerId);
  if (error) {
    if (error.code === '42501') return { error: 'forbidden' };
    return { error: 'generic' };
  }

  // Quitar la decisión = el jugador vuelve a convocado por defecto → al
  // banquillo de las alineaciones (PART 2.4).
  try {
    await syncLineupsForDecision(supabase, eventId, playerId, true);
  } catch (e) {
    console.error('syncLineupsForDecision error', e);
  }

  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}`,
    'page'
  );
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}/alineacion`,
    'page'
  );
  return { success: true };
}
