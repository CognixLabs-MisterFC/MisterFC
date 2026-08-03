/**
 * O2-7b-2 — Publicar / republicar convocatoria (staff), orquestación framework-
 * agnóstica. Extraída de las Server Actions web `publishCallup` / `republishCallup`
 * (apps/web/.../convocatorias/actions.ts) para compartirla con el route handler
 * nativo (bearer). La web pasa a delegar (wrapper con Sentry + notify-bus),
 * comportamiento idéntico.
 *
 * ORDEN = GARANTÍA DE SEGURIDAD:
 *   1. El cambio de estado (match_callup_meta.published_at) se hace con el cliente
 *      RLS del usuario. La RLS (user_can_manage_callup) exige ser staff de gestión
 *      del equipo → 42501 → 'forbidden'. NUNCA service-role para publicar.
 *   2. El FAN-OUT (service-role: resolución de destinatarios —Bug CC— + campana +
 *      push blindado O2-4) es un callback INYECTADO que solo se invoca DESPUÉS de
 *      publicar/republicar con éxito. Core no importa el admin client ni Sentry;
 *      ambos se inyectan en la web (`notifyCallup`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { publishCallupSchema } from '../schemas/callup';
import {
  calledUpLimitApplies,
  calledUpOverflow,
  maxCalledUpFor,
} from '../lineups/rules';
import type { TeamFormat } from '../lineups/types';

type Sb = SupabaseClient<Database>;

/**
 * Fan-out inyectado. En la web es `notifyCallup`: resuelve las cuentas de las
 * familias de los convocados con service-role (Bug CC: la RLS del coach podría no
 * ver player_accounts) y emite campana + push blindado (O2-4). Core solo lo llama
 * DESPUÉS de publicar; nunca antes, nunca como service-role para publicar.
 */
export type CallupFanOut = (
  eventId: string,
  kind: 'callup_published' | 'callup_updated',
  dedupeToken?: string,
) => Promise<void>;

/** Sumidero de errores para el caller (web: Sentry). */
export type CallupPublishLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;

export type PublishCallupError =
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

export type PublishCallupOutcome =
  | { ok: true; published: boolean }
  | {
      ok: false;
      error: PublishCallupError;
      overflow?: number;
      maxCalledUp?: number;
    };

export type RepublishCallupError =
  | 'not_found'
  | 'not_published'
  | 'event_started'
  | 'too_many_called_up'
  | 'forbidden'
  | 'generic';

export type RepublishCallupOutcome =
  | { ok: true }
  | {
      ok: false;
      error: RepublishCallupError;
      overflow?: number;
      maxCalledUp?: number;
    };

const noopLog: CallupPublishLogger = () => {};

function mapPublishValidationErr(code: string | undefined): PublishCallupError {
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
    return code as PublishCallupError;
  }
  return 'generic';
}

function mapPublishPgErr(
  message: string | undefined,
  pgcode: string | undefined,
): PublishCallupError {
  if (pgcode === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'event_not_match';
  if (message.includes('event_without_team')) return 'event_without_team';
  if (message.includes('cannot_unpublish')) return 'cannot_unpublish';
  return 'generic';
}

/**
 * F6 Mejora 3 — tope de convocados por modalidad. Devuelve el desbordamiento si el
 * nº de convocados (roster a fecha − descartados) excede el máximo de la modalidad;
 * null si cabe o no aplica (amistoso/torneo). Se lee con el cliente del usuario.
 */
async function checkCalledUpLimit(
  supabase: Sb,
  eventId: string,
): Promise<{ overflow: number; maxCalledUp: number } | null> {
  const { data: ev } = await supabase
    .from('events')
    .select('type, team_id, starts_at, teams!inner(format)')
    .eq('id', eventId)
    .maybeSingle();
  const teamId = (ev?.team_id as string | null) ?? null;
  if (!ev || !teamId) return null;

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
      .map((d) => d.player_id as string),
  );
  const calledUp = rosterIds.filter((id) => !discarded.has(id)).length;

  const overflow = calledUpOverflow(calledUp, format);
  if (overflow > 0) {
    return { overflow, maxCalledUp: maxCalledUpFor(format) };
  }
  return null;
}

/**
 * Guarda o publica los datos de citación de un partido. Si `publish=true` y la fila
 * NO estaba publicada, setea published_at=now (el trigger valida y fuerza
 * published_by=auth.uid). No usa `.upsert()` (lección PR #19): detección manual
 * existing → UPDATE / falta → INSERT. Al PUBLICAR por primera vez aplica el tope y,
 * tras el éxito, dispara el fan-out `callup_published` (inyectado).
 */
export async function publishCallupFromClient(
  supabase: Sb,
  input: unknown,
  fanOut: CallupFanOut,
  logError?: CallupPublishLogger,
): Promise<PublishCallupOutcome> {
  const log = logError ?? noopLog;
  const parsed = publishCallupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: mapPublishValidationErr(parsed.error.issues[0]?.message),
    };
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

  const { data: existing } = await supabase
    .from('match_callup_meta')
    .select('event_id, published_at')
    .eq('event_id', event_id)
    .maybeSingle();

  // Al PUBLICAR (transición a publicada), bloquear si el nº de convocados excede
  // el máximo de la modalidad.
  if (publish && existing?.published_at == null) {
    const gate = await checkCalledUpLimit(supabase, event_id);
    if (gate) {
      return {
        ok: false,
        error: 'too_many_called_up',
        overflow: gate.overflow,
        maxCalledUp: gate.maxCalledUp,
      };
    }
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
    if (error) {
      return { ok: false, error: mapPublishPgErr(error.message, error.code) };
    }
  } else {
    const { error } = await supabase.from('match_callup_meta').insert({
      event_id,
      ...payloadCommon,
      published_at: publishedNow,
    });
    if (error) {
      return { ok: false, error: mapPublishPgErr(error.message, error.code) };
    }
  }

  const finalPublished = publish || existing?.published_at != null;

  // Notificación a la familia SOLO en la primera publicación (pending → published).
  const isFirstPublish = publish && existing?.published_at == null;
  if (isFirstPublish) {
    try {
      await fanOut(event_id, 'callup_published');
    } catch (e) {
      log(e, 'notify_callup_published', { event_id });
    }
  }

  return { ok: true, published: !!finalPublished };
}

/**
 * Bug G — re-publica una convocatoria YA publicada tras cambios del cuerpo técnico,
 * notificando `callup_updated` (con dedupe token único para no deduplicar con la
 * publicación anterior). Permitido hasta events.starts_at. Re-aplica el tope.
 */
export async function republishCallupFromClient(
  supabase: Sb,
  eventId: string,
  fanOut: CallupFanOut,
  logError?: CallupPublishLogger,
): Promise<RepublishCallupOutcome> {
  const log = logError ?? noopLog;

  const { data: meta } = await supabase
    .from('match_callup_meta')
    .select('published_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (!meta) return { ok: false, error: 'not_found' };
  if (meta.published_at == null) return { ok: false, error: 'not_published' };

  const { data: ev } = await supabase
    .from('events')
    .select('starts_at')
    .eq('id', eventId)
    .maybeSingle();
  if (ev?.starts_at && new Date(ev.starts_at).getTime() < Date.now()) {
    return { ok: false, error: 'event_started' };
  }

  const gate = await checkCalledUpLimit(supabase, eventId);
  if (gate) {
    return {
      ok: false,
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
    return { ok: false, error: error.code === '42501' ? 'forbidden' : 'generic' };
  }

  try {
    await fanOut(eventId, 'callup_updated', String(Date.now()));
  } catch (e) {
    log(e, 'notify_callup_updated', { event_id: eventId });
  }

  return { ok: true };
}
