'use server';

/**
 * F13.10 — Server actions de OBJETIVOS del Informe de desarrollo (individuales del
 * jugador + grupales del equipo). El editor de PUNTUACIONES quedó EN RECONSTRUCCIÓN
 * tras el rework del modelo (scores jsonb / catálogos); su acción se reintroduce
 * con el editor nuevo. La RLS es el gate real; el trigger fuerza created_by/club.
 */

import { revalidatePath } from 'next/cache';
import {
  upsertPlayerObjectiveSchema,
  upsertTeamObjectiveSchema,
  deleteObjectiveSchema,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

function mapPgErr(code: string | undefined): 'forbidden' | 'generic' {
  return code === '42501' ? 'forbidden' : 'generic';
}

// ── Objetivos (13.10b-2): individuales del jugador + grupales del equipo ─────────

export type ObjectiveState = {
  error?: 'invalid' | 'forbidden' | 'not_found' | 'generic';
  success?: boolean;
};

function revalidateInformes(playerId: string) {
  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}/informes`, 'page');
}

const txtOrNull = (formData: FormData, key: string): string | null => {
  const raw = formData.get(key);
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
};
const strField = (formData: FormData, key: string): string => String(formData.get(key) ?? '');

/** Crea/edita un objetivo INDIVIDUAL del jugador (id presente = update). */
export async function upsertPlayerObjective(
  _prev: ObjectiveState,
  formData: FormData,
): Promise<ObjectiveState> {
  const id = txtOrNull(formData, 'id');
  const input = {
    ...(id ? { id } : {}),
    player_id: strField(formData, 'player_id'),
    team_id: strField(formData, 'team_id'),
    season_id: strField(formData, 'season_id'),
    title: strField(formData, 'title'),
    description: txtOrNull(formData, 'description'),
    status: strField(formData, 'status'),
    created_period: strField(formData, 'created_period'),
  };
  const parsed = upsertPlayerObjectiveSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const d = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (d.id) {
    // created_period es inmutable → solo title/description/status.
    const { error } = await supabase
      .from('player_objectives')
      .update({ title: d.title, description: d.description, status: d.status })
      .eq('id', d.id);
    if (error) return { error: mapPgErr(error.code) };
  } else {
    const { error } = await supabase.from('player_objectives').insert({
      club_id: ctx.activeClub.club.id, // el trigger lo deriva igualmente
      team_id: d.team_id,
      player_id: d.player_id,
      season_id: d.season_id,
      title: d.title,
      description: d.description,
      status: d.status,
      created_period: d.created_period,
    });
    if (error) return { error: mapPgErr(error.code) };
  }

  revalidateInformes(d.player_id);
  return { success: true };
}

/** Crea/edita un objetivo GRUPAL del equipo (id presente = update). */
export async function upsertTeamObjective(
  _prev: ObjectiveState,
  formData: FormData,
): Promise<ObjectiveState> {
  const id = txtOrNull(formData, 'id');
  const playerId = strField(formData, 'player_id'); // solo para revalidar la vista
  const input = {
    ...(id ? { id } : {}),
    team_id: strField(formData, 'team_id'),
    season_id: strField(formData, 'season_id'),
    title: strField(formData, 'title'),
    description: txtOrNull(formData, 'description'),
    status: strField(formData, 'status'),
  };
  const parsed = upsertTeamObjectiveSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const d = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (d.id) {
    const { error } = await supabase
      .from('team_objectives')
      .update({ title: d.title, description: d.description, status: d.status })
      .eq('id', d.id);
    if (error) return { error: mapPgErr(error.code) };
  } else {
    const { error } = await supabase.from('team_objectives').insert({
      club_id: ctx.activeClub.club.id, // el trigger lo deriva igualmente
      team_id: d.team_id,
      season_id: d.season_id,
      title: d.title,
      description: d.description,
      status: d.status,
    });
    if (error) return { error: mapPgErr(error.code) };
  }

  revalidateInformes(playerId);
  return { success: true };
}

/** Borra un objetivo (individual o grupal según `kind`). */
export async function deleteObjective(
  _prev: ObjectiveState,
  formData: FormData,
): Promise<ObjectiveState> {
  const parsed = deleteObjectiveSchema.safeParse({ id: strField(formData, 'id') });
  if (!parsed.success) return { error: 'invalid' };
  const kind = strField(formData, 'kind');
  const playerId = strField(formData, 'player_id');
  const table = kind === 'team' ? 'team_objectives' : 'player_objectives';

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { error } = await supabase.from(table).delete().eq('id', parsed.data.id);
  if (error) return { error: mapPgErr(error.code) };

  revalidateInformes(playerId);
  return { success: true };
}
