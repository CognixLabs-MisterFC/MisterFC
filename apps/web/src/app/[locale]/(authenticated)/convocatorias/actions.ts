'use server';

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServerClient,
  publishCallupSchema,
  upsertCallupDecisionSchema,
  upsertCallupResponseSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

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
    | 'forbidden'
    | 'generic';
  success?: boolean;
  published?: boolean;
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
  return { success: true, published: !!finalPublished };
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

  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${parsed.data.event_id}`,
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
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}`,
    'page'
  );
  return { success: true };
}
