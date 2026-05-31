'use server';

import { revalidatePath } from 'next/cache';
import {
  callupDecisionForLocation,
  createLineupSchema,
  createPlannedSubSchema,
  createSupabaseServerClient,
  defaultFormation,
  deleteLineupPositionSchema,
  deletePlannedSubSchema,
  getFormation,
  remapToFormation,
  roleFromPosition,
  setLineupFormationSchema,
  setLineupOfficialSchema,
  setLineupVisibilitySchema,
  setTacticalNotesSchema,
  upsertLineupPositionSchema,
  type LineupLocation,
  type PlayerPositionMain,
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
  | 'out_reason_coherence'
  | 'coords_only_field'
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
  if (message.includes('lineup_positions_out_reason_coherent')) return 'out_reason_coherence';
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

// ─────────────────────────────────────────────────────────────────────────────
// createLineup — crea la cabecera y siembra el banquillo con el roster a fecha.
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

  // Siembra el banquillo con el roster a la fecha del partido (fallback manual,
  // sin callup_status; el import de convocatoria F6.6 llega en Lote B).
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
    if (rosterIds.length > 0) {
      await supabase.from('lineup_positions').insert(
        rosterIds.map((pid) => ({
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
// upsertLineupPosition — coloca/mueve un jugador (field/bench/out).
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
    out_reason: v.out_reason,
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
        out_reason: null,
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
        out_reason: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// applyCallupSync (F6.6 alineación→convocatoria) — auto-marca descarte/convocado.
//
// out → callup_decisions.discarded; field/bench → called_up. Si la convocatoria
// está PUBLICADA y no se confirmó, devuelve needsConfirm (no toca la convocatoria
// publicada en silencio). El reason del descarte guarda el out_reason.
// ─────────────────────────────────────────────────────────────────────────────

export type CallupSyncState = {
  error?: ActionError;
  success?: boolean;
  needsConfirm?: boolean;
  decision?: 'called_up' | 'discarded';
};

export async function applyCallupSync(args: {
  event_id: string;
  player_id: string;
  location: LineupLocation;
  out_reason?: string | null;
  confirm?: boolean;
}): Promise<CallupSyncState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const decision = callupDecisionForLocation(args.location);

  const { data: meta } = await supabase
    .from('match_callup_meta')
    .select('published_at')
    .eq('event_id', args.event_id)
    .maybeSingle();
  const published = meta?.published_at != null;
  if (published && !args.confirm) {
    return { needsConfirm: true, decision };
  }

  const reason = decision === 'discarded' ? (args.out_reason ?? null) : null;

  const { data: existing } = await supabase
    .from('callup_decisions')
    .select('event_id')
    .eq('event_id', args.event_id)
    .eq('player_id', args.player_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('callup_decisions')
      .update({ decision, reason })
      .eq('event_id', args.event_id)
      .eq('player_id', args.player_id);
    if (error) return { error: mapPgErr(error.message, error.code) };
  } else {
    const { error } = await supabase.from('callup_decisions').insert({
      event_id: args.event_id,
      player_id: args.player_id,
      decision,
      reason,
      decided_by: user.id,
    });
    if (error) return { error: mapPgErr(error.message, error.code) };
  }

  revalidate(args.event_id);
  return { success: true, decision };
}

// ─────────────────────────────────────────────────────────────────────────────
// resyncFromCallup (F6.6 convocatoria→alineación) — reimport explícito.
//
// Lee callup_decisions del evento y aplica al lineup: descartados → out,
// y los que estaban out pero ya NO están descartados → bench. No es sync vivo
// (decisión: reimport explícito, sin trigger F4→F6).
// ─────────────────────────────────────────────────────────────────────────────

export type ResyncedPosition = {
  playerId: string;
  location: LineupLocation;
  positionCode: string | null;
  xPct: number | null;
  yPct: number | null;
  outReason: string | null;
};

export type ResyncState = {
  error?: ActionError;
  success?: boolean;
  toOut?: number;
  toBench?: number;
  positions?: ResyncedPosition[];
};

export async function resyncFromCallup(lineupId: string): Promise<ResyncState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const eventId = await eventIdOfLineup(supabase, lineupId);
  if (!eventId) return { error: 'not_found' };

  const { data: decisions } = await supabase
    .from('callup_decisions')
    .select('player_id, decision')
    .eq('event_id', eventId);
  const discarded = new Set(
    (decisions ?? [])
      .filter((d) => (d.decision as string) === 'discarded')
      .map((d) => d.player_id as string),
  );

  const { data: positions } = await supabase
    .from('lineup_positions')
    .select('player_id, location')
    .eq('lineup_id', lineupId);

  let toOut = 0;
  let toBench = 0;
  for (const p of positions ?? []) {
    const pid = p.player_id as string;
    const loc = p.location as LineupLocation;
    if (discarded.has(pid) && loc !== 'out') {
      const { error } = await supabase
        .from('lineup_positions')
        .update({ location: 'out', out_reason: 'tecnico', position_code: null, x_pct: null, y_pct: null })
        .eq('lineup_id', lineupId)
        .eq('player_id', pid);
      if (error) return { error: mapPgErr(error.message, error.code) };
      toOut += 1;
    } else if (!discarded.has(pid) && loc === 'out') {
      const { error } = await supabase
        .from('lineup_positions')
        .update({ location: 'bench', out_reason: null })
        .eq('lineup_id', lineupId)
        .eq('player_id', pid);
      if (error) return { error: mapPgErr(error.message, error.code) };
      toBench += 1;
    }
  }

  // Devuelve el estado final de posiciones para que el cliente lo refleje sin
  // depender de un re-render con props (el editor mantiene estado local).
  const { data: finalRows } = await supabase
    .from('lineup_positions')
    .select('player_id, location, position_code, x_pct, y_pct, out_reason')
    .eq('lineup_id', lineupId);
  type Row = {
    player_id: string;
    location: LineupLocation;
    position_code: string | null;
    x_pct: number | string | null;
    y_pct: number | string | null;
    out_reason: string | null;
  };
  const positionsOut: ResyncedPosition[] = (finalRows ?? [])
    .map((r) => r as unknown as Row)
    .map((r) => ({
      playerId: r.player_id,
      location: r.location,
      positionCode: r.position_code,
      xPct: r.x_pct == null ? null : Number(r.x_pct),
      yPct: r.y_pct == null ? null : Number(r.y_pct),
      outReason: r.out_reason,
    }));

  revalidate(eventId);
  return { success: true, toOut, toBench, positions: positionsOut };
}
