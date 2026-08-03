'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  clearCallupDecisionFromClient,
  createSupabaseServerClient,
  respondCallupFromClient,
  upsertCallupDecisionFromClient,
  upsertCallupResponseSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { publishCallupWeb, republishCallupWeb } from '@/lib/publish-callup';

// ─────────────────────────────────────────────────────────────────────────────
// publishCallup (F4.4)
//
// Guarda o publica los datos de citación para un partido. Si `publish=true` y la
// fila no existía publicada, se setea published_at = now().
//
// O2-7b-2 — la orquestación (guardar/publicar como el usuario + tope + fan-out
// callup_published) se extrajo a core (`publishCallupFromClient`) y se comparte con
// el route handler nativo vía `@/lib/publish-callup`. Aquí queda el wrapper de la
// Server Action: construye el cliente cookie, delega y revalida. Comportamiento
// web idéntico.
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

export async function publishCallup(
  input: unknown
): Promise<PublishCallupState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Guardar/publicar como el usuario (RLS = gate) + tope + fan-out (core, vía el
  // wrapper que inyecta notify-bus + Sentry). El fan-out solo ocurre en la 1ª
  // publicación, dentro de core, DESPUÉS del cambio de estado.
  const res = await publishCallupWeb(supabase, input);
  if (!res.ok) {
    return {
      error: res.error,
      ...(res.overflow != null ? { overflow: res.overflow } : {}),
      ...(res.maxCalledUp != null ? { maxCalledUp: res.maxCalledUp } : {}),
    };
  }

  const eventId = (input as { event_id?: string }).event_id ?? '';
  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}`,
    'page'
  );
  revalidatePath(`/[locale]/(authenticated)/calendario`, 'page');
  return { success: true, published: res.published };
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

  // Re-publicar como el usuario (RLS = gate) + tope + fan-out callup_updated (core,
  // vía el wrapper que inyecta notify-bus + Sentry). El fan-out va DESPUÉS del
  // cambio de estado.
  const res = await republishCallupWeb(supabase, eventId);
  if (!res.ok) {
    return {
      error: res.error,
      ...(res.overflow != null ? { overflow: res.overflow } : {}),
      ...(res.maxCalledUp != null ? { maxCalledUp: res.maxCalledUp } : {}),
    };
  }

  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
  revalidatePath(`/[locale]/(authenticated)/convocatorias/${eventId}`, 'page');
  revalidatePath('/[locale]/(authenticated)/calendario', 'page');
  return { success: true };
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

  // O2-5 E1 — la escritura (SELECT→UPDATE/INSERT con responded_by=auth.uid) se
  // extrajo a core para compartirla con la app nativa. Comportamiento idéntico:
  // aquí solo se mapea el error pg y se revalida.
  const res = await respondCallupFromClient(supabase, parsed.data);
  if (!res.ok) {
    if (res.noUser) return { error: 'forbidden' };
    return { error: mapUpsertResponsePgErr(res.message, res.code) };
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

export async function upsertCallupDecision(
  input: unknown
): Promise<UpsertDecisionState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // O2-7b-1 — la escritura (upsert incremental SELECT→UPDATE/INSERT con
  // decided_by=auth.uid + sync de alineación best-effort) se extrajo a core para
  // compartirla con la app nativa. Comportamiento idéntico: aquí solo se inyecta el
  // logger (console + Sentry) y se revalida. El GATE (quién convoca) sigue siendo la
  // RLS server-side (42501 → 'forbidden'); no se reimplementa aquí.
  const res = await upsertCallupDecisionFromClient(supabase, input, (e) => {
    console.error('syncLineupsForDecision error', e);
    Sentry.captureException(e, {
      tags: { feature: 'callups', step: 'sync_lineups_decision' },
    });
  });
  if (!res.ok) return { error: res.error };

  const eventId = (input as { event_id?: string }).event_id ?? '';
  revalidatePath('/[locale]/(authenticated)/convocatorias', 'page');
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

  // O2-7b-1 — delega en core (DELETE + sync de alineación como convocado,
  // best-effort). Comportamiento idéntico; el gate sigue en la RLS (42501).
  const res = await clearCallupDecisionFromClient(
    supabase,
    eventId,
    playerId,
    (e) => {
      console.error('syncLineupsForDecision error', e);
      Sentry.captureException(e, {
        tags: { feature: 'callups', step: 'sync_lineups_decision' },
      });
    },
  );
  if (!res.ok) return { error: res.error };

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
