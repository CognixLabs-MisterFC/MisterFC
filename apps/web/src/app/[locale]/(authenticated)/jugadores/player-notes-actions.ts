'use server';

/**
 * F7 (mejora) — Server actions de las notas por jugador (player_notes).
 *
 * Compartidas por la ficha del jugador y por la captura en vivo (/directo). El
 * gate autoritativo es la RLS (user_can_access_player_notes: cuerpo técnico del
 * jugador + admin/coord, NUNCA jugador/familia); aquí validamos la forma y
 * derivamos club_id/author (el trigger los re-fuerza). Persisten → la ficha los
 * lista con fecha y autor.
 */

import { revalidatePath } from 'next/cache';
import {
  createPlayerNoteSchema,
  createSupabaseServerClient,
  deletePlayerNoteSchema,
  updatePlayerNoteSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type PlayerNoteState = { error?: string; success?: boolean };

function revalidatePlayer(playerId: string) {
  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
}

export async function createPlayerNote(input: unknown): Promise<PlayerNoteState> {
  const parsed = createPlayerNoteSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { player_id, note, match_event_id, team_id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  // club_id NOT NULL en el tipo Insert; el trigger lo deriva igualmente del jugador.
  const { data: player } = await supabase
    .from('players')
    .select('club_id')
    .eq('id', player_id)
    .maybeSingle();
  if (!player) return { error: 'not_found' };

  const { error } = await supabase.from('player_notes').insert({
    player_id,
    club_id: player.club_id as string,
    author_profile_id: user.id,
    note,
    match_event_id: match_event_id ?? null,
    team_id: team_id ?? null,
  });
  if (error) return { error: error.code === '42501' ? 'forbidden' : 'generic' };

  revalidatePlayer(player_id);
  return { success: true };
}

export async function updatePlayerNote(input: unknown): Promise<PlayerNoteState> {
  const parsed = updatePlayerNoteSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { id, note } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: row, error } = await supabase
    .from('player_notes')
    .update({ note })
    .eq('id', id)
    .select('player_id')
    .maybeSingle();
  if (error) return { error: error.code === '42501' ? 'forbidden' : 'generic' };
  if (row?.player_id) revalidatePlayer(row.player_id as string);
  return { success: true };
}

export async function deletePlayerNote(input: unknown): Promise<PlayerNoteState> {
  const parsed = deletePlayerNoteSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { id } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: row, error } = await supabase
    .from('player_notes')
    .delete()
    .eq('id', id)
    .select('player_id')
    .maybeSingle();
  if (error) return { error: error.code === '42501' ? 'forbidden' : 'generic' };
  if (row?.player_id) revalidatePlayer(row.player_id as string);
  return { success: true };
}
