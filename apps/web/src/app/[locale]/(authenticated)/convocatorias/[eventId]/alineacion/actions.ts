'use server';

import { revalidatePath } from 'next/cache';
import {
  createLineupSchema,
  createPlannedSubSchema,
  createSupabaseServerClient,
  defaultFormation,
  deleteLineupPositionSchema,
  deletePlannedSubSchema,
  exceedsStarters,
  getFormation,
  remapToFormation,
  renameLineupSchema,
  roleFromPosition,
  setLineupFormationSchema,
  setLineupOfficialSchema,
  setLineupVisibilitySchema,
  setTacticalNotesSchema,
  upsertLineupPositionSchema,
  type PlayerPositionMain,
  type TeamFormat,
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

/** Modalidad del equipo del evento (para topar titulares por modalidad). */
async function teamFormatOfEvent(
  supabase: Supa,
  eventId: string,
): Promise<TeamFormat | null> {
  const { data } = await supabase
    .from('events')
    .select('teams!inner(format)')
    .eq('id', eventId)
    .maybeSingle();
  const fmt = (data as unknown as { teams?: { format?: string } } | null)?.teams
    ?.format;
  return (fmt as TeamFormat | undefined) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// createLineup — crea la cabecera y siembra el banquillo con los CONVOCADOS.
//
// Rediseño Lote B': la alineación distribuye a los convocados (called_up), no a
// todo el roster. called_up = roster a fecha − descartados en callup_decisions.
// Si aún no hay decisiones (convocatoria sin tocar), called_up = roster entero
// (todos los que el coach espera llevar).
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

  const { data: created, error } = await supabase
    .from('lineups')
    .insert({ event_id, name, formation_code, created_by: user.id })
    .select('id')
    .maybeSingle();
  if (error) return { error: mapPgErr(error.message, error.code) };
  const lineupId = created?.id as string | undefined;
  if (!lineupId) return { error: 'generic' };

  // Siembra el banquillo con los convocados (roster a fecha − descartados).
  const { data: ev } = await supabase
    .from('events')
    .select('team_id, starts_at')
    .eq('id', event_id)
    .maybeSingle();
  if (ev?.team_id) {
    const eventDate = (ev.starts_at as string).slice(0, 10);
    const { data: tms } = await supabase
      .from('team_members')
      .select('player_id, joined_at, left_at')
      .eq('team_id', ev.team_id)
      .lte('joined_at', eventDate);
    type TM = { player_id: string; joined_at: string; left_at: string | null };
    const rosterIds = (tms ?? [])
      .map((r) => r as unknown as TM)
      .filter((r) => r.left_at == null || r.left_at >= eventDate)
      .map((r) => r.player_id);

    const { data: decisions } = await supabase
      .from('callup_decisions')
      .select('player_id, decision')
      .eq('event_id', event_id);
    const discarded = new Set(
      (decisions ?? [])
        .filter((d) => (d.decision as string) === 'discarded')
        .map((d) => d.player_id as string),
    );
    const calledUp = rosterIds.filter((pid) => !discarded.has(pid));

    if (calledUp.length > 0) {
      await supabase.from('lineup_positions').insert(
        calledUp.map((pid) => ({
          lineup_id: lineupId,
          player_id: pid,
          location: 'bench' as const,
        })),
      );
    }
  }

  revalidate(event_id);
  return { success: true, lineupId };
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertLineupPosition — coloca/mueve un jugador (field/bench).
//
// Bug F: al colocar en el campo se respeta el máximo de titulares de la
// modalidad (F7=7, F8=8, F11=11). El cliente persiste primero los desplazados
// (a banquillo) y luego el nuevo titular, de modo que un swap legítimo no choca
// con el tope; un exceso real (más jugadores que titulares de la modalidad) sí.
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertLineupPosition(input: unknown): Promise<LineupActionState> {
  const parsed = upsertLineupPositionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: (parsed.error.issues[0]?.message as ActionError) ?? 'invalid' };
  }
  const v = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const eventId = await eventIdOfLineup(supabase, v.lineup_id);
  if (!eventId) return { error: 'not_found' };

  // Tope de titulares por modalidad (solo al colocar/mover a campo).
  if (v.location === 'field') {
    const format = await teamFormatOfEvent(supabase, eventId);
    if (format) {
      const { data: fieldRows } = await supabase
        .from('lineup_positions')
        .select('player_id')
        .eq('lineup_id', v.lineup_id)
        .eq('location', 'field');
      const fieldOthers = (fieldRows ?? [])
        .map((r) => r.player_id as string)
        .filter((pid) => pid !== v.player_id);
      // El jugador objetivo se suma a los demás titulares ya presentes.
      if (exceedsStarters(fieldOthers.length + 1, format)) {
        return { error: 'too_many_starters' };
      }
    }
  }

  const { data: existing } = await supabase
    .from('lineup_positions')
    .select('id')
    .eq('lineup_id', v.lineup_id)
    .eq('player_id', v.player_id)
    .maybeSingle();

  const row = {
    location: v.location,
    position_code: v.position_code,
    x_pct: v.x_pct,
    y_pct: v.y_pct,
  };

  if (existing) {
    const { error } = await supabase
      .from('lineup_positions')
      .update(row)
      .eq('id', existing.id as string);
    if (error) return { error: mapPgErr(error.message, error.code) };
  } else {
    const { error } = await supabase
      .from('lineup_positions')
      .insert({ lineup_id: v.lineup_id, player_id: v.player_id, ...row });
    if (error) return { error: mapPgErr(error.message, error.code) };
  }

  revalidate(eventId);
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

  revalidate(eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupOfficial — marca oficial (desmarca las demás del mismo evento).
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupOfficial(input: unknown): Promise<LineupActionState> {
  const parsed = setLineupOfficialSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { lineup_id, is_official } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, lineup_id);
  if (!eventId) return { error: 'not_found' };

  if (is_official) {
    // Desmarca cualquier otra oficial del evento antes (índice parcial único).
    const { error: clearErr } = await supabase
      .from('lineups')
      .update({ is_official: false })
      .eq('event_id', eventId)
      .neq('id', lineup_id);
    if (clearErr) return { error: mapPgErr(clearErr.message, clearErr.code) };
  }

  const { error } = await supabase
    .from('lineups')
    .update({ is_official })
    .eq('id', lineup_id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(eventId);
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
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupFormation(input: unknown): Promise<LineupActionState> {
  const parsed = setLineupFormationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { lineup_id, formation_code } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, lineup_id);
  if (!eventId) return { error: 'not_found' };

  const next = getFormation(formation_code) ?? defaultFormation('F11');

  // Titulares actuales + su rol de ficha para reasignar conservando posición.
  const { data: fieldRows } = await supabase
    .from('lineup_positions')
    .select('player_id, players!inner(position_main)')
    .eq('lineup_id', lineup_id)
    .eq('location', 'field');
  type FieldShape = { player_id: string; players: { position_main: PlayerPositionMain } };
  const fieldPlayers = (fieldRows ?? []).map((r) => {
    const f = r as unknown as FieldShape;
    return { playerId: f.player_id, role: roleFromPosition(f.players.position_main) };
  });

  const { assignments, benched } = remapToFormation(fieldPlayers, next);

  // Actualiza la cabecera.
  {
    const { error } = await supabase
      .from('lineups')
      .update({ formation_code })
      .eq('id', lineup_id);
    if (error) return { error: mapPgErr(error.message, error.code) };
  }

  // Reubica titulares en los slots de la nueva formación.
  for (const a of assignments) {
    const { error } = await supabase
      .from('lineup_positions')
      .update({
        location: 'field',
        position_code: a.positionCode,
        x_pct: a.xPct,
        y_pct: a.yPct,
      })
      .eq('lineup_id', lineup_id)
      .eq('player_id', a.playerId);
    if (error) return { error: mapPgErr(error.message, error.code) };
  }
  // Los que ya no caben → banquillo.
  for (const playerId of benched) {
    const { error } = await supabase
      .from('lineup_positions')
      .update({
        location: 'bench',
        position_code: null,
        x_pct: null,
        y_pct: null,
      })
      .eq('lineup_id', lineup_id)
      .eq('player_id', playerId);
    if (error) return { error: mapPgErr(error.message, error.code) };
  }

  revalidate(eventId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupVisibility (F6 Lote B) — compartir con equipo/familias.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupVisibility(input: unknown): Promise<LineupActionState> {
  const parsed = setLineupVisibilitySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, parsed.data.lineup_id);
  if (!eventId) return { error: 'not_found' };

  const { error } = await supabase
    .from('lineups')
    .update({ visibility: parsed.data.visibility })
    .eq('id', parsed.data.lineup_id);
  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate(eventId);
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
