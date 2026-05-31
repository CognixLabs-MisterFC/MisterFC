'use server';

import { revalidatePath } from 'next/cache';
import {
  createLineupSchema,
  createSupabaseServerClient,
  defaultFormation,
  deleteLineupPositionSchema,
  getFormation,
  remapToFormation,
  roleFromPosition,
  setLineupFormationSchema,
  setLineupOfficialSchema,
  upsertLineupPositionSchema,
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
