/**
 * O2-7b-1 — ESCRITURA de DECISIONES de convocatoria (cuerpo técnico), framework-
 * agnóstica. Extraído de `apps/web/.../convocatorias/actions.ts` (`upsertCallupDecision`
 * + `clearCallupDecision` + `syncLineupsForDecision`). La web pasa a delegar (misma
 * lógica → comportamiento idéntico) y añade su `revalidatePath`; la app nativa la
 * llama directamente detrás del write-guard.
 *
 * INCREMENTAL por (event_id, player_id): cada decisión es UN upsert manual
 * (SELECT → UPDATE|INSERT), NO un batch. NO se usa upsert de PostgREST (evaluaría la
 * policy INSERT WITH CHECK en el path UPDATE — lección PR #19). Semántica canónica:
 * convocado = roster − descartados.
 *
 * El GATE (quién puede convocar) es server-side (`user_can_manage_callup`): la RLS
 * rechaza (42501→`forbidden`) al staff sin permiso; NO se reimplementa en cliente.
 *
 * LINEUP-SYNC (best-effort): al decidir se propaga a `lineup_positions` (descartar→
 * quita, convocar→banquillo). Un fallo del sync NO rompe la decisión: se captura y
 * se reporta por `onSyncError` (web: Sentry; core no depende de Sentry).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { upsertCallupDecisionSchema } from '../schemas/callup';
import { getCurrentUserFromClient } from '../auth/current-user';

type DbClient = SupabaseClient<Database>;

export type CallupDecisionError =
  | 'event_invalid'
  | 'player_invalid'
  | 'decision_invalid'
  | 'reason_too_long'
  | 'event_not_match'
  | 'player_not_in_team_at_event'
  | 'forbidden'
  | 'generic';

export type CallupDecisionOutcome =
  | { ok: true }
  | { ok: false; error: CallupDecisionError };

export type ClearCallupDecisionOutcome =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'generic' };

/** Sumidero de errores del sync (web: Sentry). Core no depende de Sentry. */
export type SyncErrorLogger = (error: unknown) => void;

function mapDecisionValidationErr(
  code: string | undefined,
): CallupDecisionError {
  const known = [
    'event_invalid',
    'player_invalid',
    'decision_invalid',
    'reason_too_long',
  ] as const;
  if (code && (known as readonly string[]).includes(code)) {
    return code as CallupDecisionError;
  }
  return 'generic';
}

function mapDecisionPgErr(
  message: string | undefined,
  pgcode: string | undefined,
): CallupDecisionError {
  if (pgcode === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'event_not_match';
  if (message.includes('player_not_in_team_at_event'))
    return 'player_not_in_team_at_event';
  return 'generic';
}

/**
 * Propaga la decisión a las alineaciones del partido. Descartar → quita al jugador
 * de `lineup_positions` de TODAS las alineaciones; convocar → lo añade al banquillo
 * de las que no lo tengan. Best-effort: el caller la envuelve para que un fallo no
 * rompa la decisión.
 */
export async function syncLineupsForDecision(
  supabase: DbClient,
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

/** Best-effort: ejecuta el sync capturando cualquier fallo (no rompe la decisión). */
async function syncLineupsBestEffort(
  supabase: DbClient,
  eventId: string,
  playerId: string,
  calledUp: boolean,
  onSyncError?: SyncErrorLogger,
): Promise<void> {
  try {
    await syncLineupsForDecision(supabase, eventId, playerId, calledUp);
  } catch (e) {
    onSyncError?.(e);
  }
}

/**
 * Marca/actualiza la decisión técnica de UN jugador (called_up | discarded). Upsert
 * incremental; `decided_by` = auth.uid en el INSERT. Tras la decisión, sincroniza la
 * alineación (best-effort).
 */
export async function upsertCallupDecisionFromClient(
  supabase: DbClient,
  input: unknown,
  onSyncError?: SyncErrorLogger,
): Promise<CallupDecisionOutcome> {
  const parsed = upsertCallupDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: mapDecisionValidationErr(parsed.error.issues[0]?.message),
    };
  }

  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { ok: false, error: 'forbidden' };

  const { data: existing } = await supabase
    .from('callup_decisions')
    .select('event_id')
    .eq('event_id', parsed.data.event_id)
    .eq('player_id', parsed.data.player_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('callup_decisions')
      .update({ decision: parsed.data.decision, reason: parsed.data.reason })
      .eq('event_id', parsed.data.event_id)
      .eq('player_id', parsed.data.player_id);
    if (error)
      return { ok: false, error: mapDecisionPgErr(error.message, error.code) };
  } else {
    const { error } = await supabase.from('callup_decisions').insert({
      event_id: parsed.data.event_id,
      player_id: parsed.data.player_id,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      decided_by: user.id,
    });
    if (error)
      return { ok: false, error: mapDecisionPgErr(error.message, error.code) };
  }

  await syncLineupsBestEffort(
    supabase,
    parsed.data.event_id,
    parsed.data.player_id,
    parsed.data.decision === 'called_up',
    onSyncError,
  );

  return { ok: true };
}

/**
 * Borra la decisión (event_id, player_id) → el jugador vuelve a convocado por
 * defecto (roster − descartados). Sincroniza la alineación como convocado (best-effort).
 */
export async function clearCallupDecisionFromClient(
  supabase: DbClient,
  eventId: string,
  playerId: string,
  onSyncError?: SyncErrorLogger,
): Promise<ClearCallupDecisionOutcome> {
  const { error } = await supabase
    .from('callup_decisions')
    .delete()
    .eq('event_id', eventId)
    .eq('player_id', playerId);
  if (error) {
    if (error.code === '42501') return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'generic' };
  }

  await syncLineupsBestEffort(supabase, eventId, playerId, true, onSyncError);

  return { ok: true };
}
