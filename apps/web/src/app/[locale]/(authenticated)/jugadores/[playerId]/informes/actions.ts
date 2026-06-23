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
  upsertDevelopmentReportSchema,
  upsertTeamDevelopmentReportSchema,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

function mapPgErr(code: string | undefined): 'forbidden' | 'generic' {
  return code === '42501' ? 'forbidden' : 'generic';
}

// ── Editor de PUNTUACIONES (13.10-editor): valoración de equipo + informe individual

export type ReportState = {
  error?: 'invalid' | 'forbidden' | 'generic';
  success?: boolean;
};

/** scores llega serializado como JSON en el form; lo parseamos a objeto. */
function parseScores(formData: FormData): unknown {
  const raw = formData.get('scores');
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null; // fuerza el fallo de zod → 'invalid'
  }
}

/** Crea/edita la VALORACIÓN DE EQUIPO (team×season×period). Upsert por unique. */
export async function upsertTeamDevelopmentReport(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const id = txtOrNull(formData, 'id');
  const input = {
    ...(id ? { id } : {}),
    team_id: strField(formData, 'team_id'),
    season_id: strField(formData, 'season_id'),
    period: strField(formData, 'period'),
    scores: parseScores(formData),
    comment: txtOrNull(formData, 'comment'),
    visibility: strField(formData, 'visibility') || 'staff',
  };
  const parsed = upsertTeamDevelopmentReportSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const d = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (d.id) {
    const { error } = await supabase
      .from('team_development_reports')
      .update({ scores: d.scores, comment: d.comment, visibility: d.visibility })
      .eq('id', d.id);
    if (error) return { error: mapPgErr(error.code) };
  } else {
    const { error } = await supabase.from('team_development_reports').insert({
      club_id: ctx.activeClub.club.id, // el trigger lo deriva igualmente
      created_by: ctx.user.id, // el trigger lo fuerza a auth.uid() igualmente
      team_id: d.team_id,
      season_id: d.season_id,
      period: d.period,
      scores: d.scores,
      comment: d.comment,
      visibility: d.visibility,
    });
    if (error) return { error: mapPgErr(error.code) };
  }

  revalidateInformes(strField(formData, 'player_id'));
  return { success: true };
}

/** Crea/edita el INFORME INDIVIDUAL (player×season×period). El trigger enlaza
 *  team_report_id con la valoración de equipo de ese periodo si existe. */
export async function upsertDevelopmentReport(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const id = txtOrNull(formData, 'id');
  const input = {
    ...(id ? { id } : {}),
    player_id: strField(formData, 'player_id'),
    team_id: strField(formData, 'team_id'),
    season_id: strField(formData, 'season_id'),
    period: strField(formData, 'period'),
    scores: parseScores(formData),
    comment_overall: txtOrNull(formData, 'comment_overall'),
    visibility: strField(formData, 'visibility') || 'staff',
  };
  const parsed = upsertDevelopmentReportSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const d = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (d.id) {
    const { error } = await supabase
      .from('development_reports')
      .update({ scores: d.scores, comment_overall: d.comment_overall, visibility: d.visibility })
      .eq('id', d.id);
    if (error) return { error: mapPgErr(error.code) };
  } else {
    const { error } = await supabase.from('development_reports').insert({
      club_id: ctx.activeClub.club.id, // el trigger lo deriva igualmente
      created_by: ctx.user.id, // el trigger lo fuerza a auth.uid() igualmente
      team_id: d.team_id,
      player_id: d.player_id,
      season_id: d.season_id,
      period: d.period,
      scores: d.scores,
      comment_overall: d.comment_overall,
      visibility: d.visibility,
    });
    if (error) return { error: mapPgErr(error.code) };
  }

  revalidateInformes(d.player_id);
  return { success: true };
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
