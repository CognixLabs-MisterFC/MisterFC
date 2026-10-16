'use server';

import { revalidatePath } from 'next/cache';
import {
  calledUpOnRemove,
  callupEventIdFor,
  createLineupFromClient,
  createLineupSchema,
  createPlannedSubSchema,
  createSupabaseServerClient,
  lineupWritesCallup,
  deleteLineupPositionSchema,
  deletePlannedSubSchema,
  renameLineupSchema,
  setLineupFormationFromClient,
  setLineupOfficialFromClient,
  setLineupVisibilityFromClient,
  setTacticalNotesSchema,
  upsertLineupPositionFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ActionError =
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'event_not_match'
  | 'event_without_team'
  | 'player_not_in_team_at_event'
  | 'position_code_coherence'
  | 'coords_only_field'
  | 'too_many_starters'
  | 'callup_not_published'
  | 'generic';

export type LineupActionState = {
  error?: ActionError;
  success?: boolean;
  lineupId?: string;
};

function mapPgErr(message: string | undefined, code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'event_not_match';
  if (message.includes('event_without_team')) return 'event_without_team';
  if (message.includes('player_not_in_team_at_event')) return 'player_not_in_team_at_event';
  if (message.includes('lineup_positions_field_has_position')) return 'position_code_coherence';
  if (message.includes('lineup_positions_coords_only_field')) return 'coords_only_field';
  if (message.includes('callup_not_published')) return 'callup_not_published';
  return 'generic';
}

function revalidate(eventId: string) {
  revalidatePath(
    `/[locale]/(authenticated)/convocatorias/${eventId}/alineacion`,
    'page',
  );
  revalidatePath(`/[locale]/(authenticated)/convocatorias/${eventId}`, 'page');
}

type Supa = ReturnType<typeof createSupabaseServerClient>;

async function eventIdOfLineup(supabase: Supa, lineupId: string): Promise<string | null> {
  const { data } = await supabase
    .from('lineups')
    .select('event_id')
    .eq('id', lineupId)
    .maybeSingle();
  return (data?.event_id as string | undefined) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2 — propagación alineación → convocatoria (called_up).
//
// Al colocar a un jugador en campo/banquillo queda CONVOCADO; al sacarlo de la
// alineación sin descartarlo, se limpia su called_up (no "convocado fantasma").
// Regla 6.6: si la convocatoria está PUBLICADA no auto-sincronizamos en
// silencio — el coach reabre/republica desde la convocatoria.
// ─────────────────────────────────────────────────────────────────────────────

async function isCallupPublished(supabase: Supa, eventId: string): Promise<boolean> {
  const { data } = await supabase
    .from('match_callup_meta')
    .select('published_at')
    .eq('event_id', eventId)
    .maybeSingle();
  return (data?.published_at as string | null | undefined) != null;
}

/**
 * F13B (T-2) — tournament_id del evento (null si no es un partido de torneo).
 * Se usa para resolver la convocatoria FUENTE (cabecera) y para no escribir la
 * convocatoria desde la alineación de un partido de torneo.
 */
async function eventTournamentId(
  supabase: Supa,
  eventId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('events')
    .select('tournament_id')
    .eq('id', eventId)
    .maybeSingle();
  return (data?.tournament_id as string | null | undefined) ?? null;
}

/** Limpia el called_up al sacar a un jugador de la alineación (solo en
 * borrador). No toca descartes. */
async function clearCalledUpOnRemoval(
  supabase: Supa,
  eventId: string,
  playerId: string,
): Promise<void> {
  // F13B (T-2) — idem: un partido de torneo no toca la convocatoria compartida.
  if (!lineupWritesCallup({ tournament_id: await eventTournamentId(supabase, eventId) })) {
    return;
  }
  const published = await isCallupPublished(supabase, eventId);
  if (calledUpOnRemove(published) !== 'delete_called_up') return;
  await supabase
    .from('callup_decisions')
    .delete()
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .eq('decision', 'called_up');
}

// ─────────────────────────────────────────────────────────────────────────────
// createLineup — crea la cabecera y siembra el banquillo con los CONVOCADOS.
//
// DELEGA en core (`createLineupFromClient`): la cabecera y la siembra del banquillo
// (roster a la fecha ∪ subidos al evento − descartados) viven ahí y las comparte la
// app nativa, que antes no podía crear nada. Aquí quedan el `revalidatePath` de Next
// y la propagación a la convocatoria.
//
// UN CAMBIO DE COMPORTAMIENTO, a propósito: ahora también siembra a los jugadores
// SUBIDOS al evento (`player_promotions`, D2.1). Esta acción es anterior a esa regla
// y leía solo `team_members`, así que un Plan B dejaba al subido fuera del banquillo
// — mientras que abrir la pantalla (el auto-crear de `loadLineupEditor`) sí lo
// sembraba. Eran dos copias de la misma regla que no decían lo mismo; gana la que ve
// el entrenador al abrir la alineación.
//
// La propagación a la convocatoria (BUG 2) se queda AQUÍ y no baja a core: el
// auto-crear de la pantalla NO la hace, así que no está duplicada. Alinear los dos
// caminos cambiaría lo que ve un entrenador —abrir la alineación le marcaría la
// convocatoria entera— y eso es una decisión, no un refactor.
// ─────────────────────────────────────────────────────────────────────────────

export async function createLineup(input: unknown): Promise<LineupActionState> {
  const parsed = createLineupSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { event_id, name, formation_code } = parsed.data;
  const r = await createLineupFromClient(supabase, { event_id, name, formation_code });
  if (!r.ok) return { error: r.error as ActionError };

  // BUG 2 — los sembrados al banquillo quedan CONVOCADOS en la convocatoria (solo
  // en borrador; regla 6.6). Marca called_up a los que aún no tienen ninguna
  // decisión; no pisa descartes. F13B: NO para partidos de torneo (su plantilla se
  // maneja solo en la cabecera).
  if (r.seeded.length > 0) {
    const tournamentId = await eventTournamentId(supabase, event_id);
    if (
      lineupWritesCallup({ tournament_id: tournamentId }) &&
      !(await isCallupPublished(supabase, event_id))
    ) {
      const { data: decisions } = await supabase
        .from('callup_decisions')
        .select('player_id')
        .eq('event_id', callupEventIdFor({ id: event_id, tournament_id: tournamentId }));
      const decided = new Set((decisions ?? []).map((d) => d.player_id as string));
      const toMark = r.seeded.filter((pid) => !decided.has(pid));
      if (toMark.length > 0) {
        await supabase.from('callup_decisions').insert(
          toMark.map((pid) => ({
            event_id,
            player_id: pid,
            decision: 'called_up' as const,
            decided_by: user.id,
          })),
        );
      }
    }
  }

  revalidate(event_id);
  return { success: true, lineupId: r.lineup.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertLineupPosition — coloca/mueve un jugador (field/bench).
//
// O2-8b — DELEGA en core (`upsertLineupPositionFromClient`): la lógica (tope de
// titulares por modalidad, upsert manual, BUG 2 → convocado) vive en core y la
// comparte la app nativa; aquí solo se añade el `revalidatePath` de Next. El
// comportamiento es idéntico al server action original.
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertLineupPosition(input: unknown): Promise<LineupActionState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const r = await upsertLineupPositionFromClient(supabase, input);
  if (!r.ok) return { error: r.error as ActionError };
  revalidate(r.eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteLineupPosition — quita a un jugador de la alineación.
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteLineupPosition(input: unknown): Promise<LineupActionState> {
  const parsed = deleteLineupPositionSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, parsed.data.lineup_id);
  if (!eventId) return { error: 'not_found' };

  const { error } = await supabase
    .from('lineup_positions')
    .delete()
    .eq('lineup_id', parsed.data.lineup_id)
    .eq('player_id', parsed.data.player_id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  // BUG 2 — sacar de la alineación sin descartar → limpiar convocado fantasma.
  await clearCalledUpOnRemoval(supabase, eventId, parsed.data.player_id);

  revalidate(eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupOfficial — marca oficial (desmarca las demás del mismo evento).
//
// O2 alineación compartida — DELEGA en core (`setLineupOfficialFromClient`): la
// guardia de convocatoria-publicada + el "desmarca las demás" viven en core y los
// comparte la app nativa; aquí solo el `revalidatePath`. Idéntico al original.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupOfficial(input: unknown): Promise<LineupActionState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const r = await setLineupOfficialFromClient(supabase, input);
  if (!r.ok) return { error: r.error as ActionError };
  revalidate(r.eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupName (Bug BB) — renombrar inline la alineación desde el header.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupName(input: unknown): Promise<LineupActionState> {
  const parsed = renameLineupSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { lineup_id, name } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, lineup_id);
  if (!eventId) return { error: 'not_found' };

  const { error } = await supabase
    .from('lineups')
    .update({ name })
    .eq('id', lineup_id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupFormation — cambia la formación y reasigna los titulares (server).
//
// O2-8b — DELEGA en core (`setLineupFormationFromClient`): el remap por rol vive en
// core y lo comparte la app nativa; aquí solo el `revalidatePath`. Idéntico al
// server action original.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupFormation(input: unknown): Promise<LineupActionState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const r = await setLineupFormationFromClient(supabase, input);
  if (!r.ok) return { error: r.error as ActionError };
  revalidate(r.eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupVisibility (F6 Lote B) — compartir con equipo/familias.
//
// O2 alineación compartida — DELEGA en core (`setLineupVisibilityFromClient`); aquí
// solo el `revalidatePath`. Idéntico al original.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupVisibility(input: unknown): Promise<LineupActionState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const r = await setLineupVisibilityFromClient(supabase, input);
  if (!r.ok) return { error: r.error as ActionError };
  revalidate(r.eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// setTacticalNotes (F6.9) — upsert/borra notas en tabla solo-staff.
// ─────────────────────────────────────────────────────────────────────────────

export async function setTacticalNotes(input: unknown): Promise<LineupActionState> {
  const parsed = setTacticalNotesSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { lineup_id, notes } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, lineup_id);
  if (!eventId) return { error: 'not_found' };

  if (notes == null) {
    const { error } = await supabase
      .from('lineup_tactical_notes')
      .delete()
      .eq('lineup_id', lineup_id);
    if (error) return { error: mapPgErr(error.message, error.code) };
  } else {
    const { data: existing } = await supabase
      .from('lineup_tactical_notes')
      .select('lineup_id')
      .eq('lineup_id', lineup_id)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from('lineup_tactical_notes')
        .update({ notes })
        .eq('lineup_id', lineup_id);
      if (error) return { error: mapPgErr(error.message, error.code) };
    } else {
      const { error } = await supabase
        .from('lineup_tactical_notes')
        .insert({ lineup_id, notes });
      if (error) return { error: mapPgErr(error.message, error.code) };
    }
  }

  revalidate(eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// planned_substitutions (F6.8) — crear / borrar.
// ─────────────────────────────────────────────────────────────────────────────

export type CreatePlannedSubState = LineupActionState & { subId?: string };

export async function createPlannedSub(input: unknown): Promise<CreatePlannedSubState> {
  const parsed = createPlannedSubSchema.safeParse(input);
  if (!parsed.success) {
    return { error: (parsed.error.issues[0]?.message as ActionError) ?? 'invalid' };
  }
  const v = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, v.lineup_id);
  if (!eventId) return { error: 'not_found' };

  const { data, error } = await supabase
    .from('planned_substitutions')
    .insert({
      lineup_id: v.lineup_id,
      minute_planned: v.minute_planned,
      player_out_id: v.player_out_id,
      player_in_id: v.player_in_id,
      position_code_target: v.position_code_target,
    })
    .select('id')
    .maybeSingle();
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(eventId);
  return { success: true, subId: (data?.id as string | undefined) ?? undefined };
}

export async function deletePlannedSub(input: unknown): Promise<LineupActionState> {
  const parsed = deletePlannedSubSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Recupera el evento (para revalidar) vía el lineup del sub.
  const { data: row } = await supabase
    .from('planned_substitutions')
    .select('lineup_id')
    .eq('id', parsed.data.id)
    .maybeSingle();
  const lineupId = (row?.lineup_id as string | undefined) ?? null;
  const eventId = lineupId ? await eventIdOfLineup(supabase, lineupId) : null;

  const { error } = await supabase
    .from('planned_substitutions')
    .delete()
    .eq('id', parsed.data.id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  if (eventId) revalidate(eventId);
  return { success: true };
}
