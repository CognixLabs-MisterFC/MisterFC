'use server';

/**
 * F13.10b-1 — Server action del editor de Informe de desarrollo (un periodo).
 *
 * Upsert directo (D7) por (player_id, season_id, period) — respeta el UNIQUE del
 * modelo (13.10a): si ya existe el informe de ese periodo se EDITA, no se duplica.
 * La RLS (development_reports) es el gate real (staff del equipo ∪ admin/coord).
 * El trigger fuerza created_by y deriva club_id. La visibilidad NO se toca aquí:
 * el informe nace 'staff' (borrador) y compartir es 13.10d → en update no se
 * sobrescribe `visibility` para no des-compartir sin querer.
 */

import { revalidatePath } from 'next/cache';
import {
  upsertDevelopmentReportSchema,
  upsertPlayerObjectiveSchema,
  upsertTeamObjectiveSchema,
  deleteObjectiveSchema,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

export type DevelopmentReportState = {
  error?: 'invalid' | 'forbidden' | 'not_found' | 'generic';
  success?: boolean;
};

function mapPgErr(code: string | undefined): DevelopmentReportState['error'] {
  if (code === '42501') return 'forbidden';
  return 'generic';
}

export async function upsertDevelopmentReport(
  _prev: DevelopmentReportState,
  formData: FormData,
): Promise<DevelopmentReportState> {
  const num = (key: string): number | null => {
    const raw = formData.get(key);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const txt = (key: string): string | null => {
    const raw = formData.get(key);
    return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  };
  const str = (key: string): string => String(formData.get(key) ?? '');

  const input = {
    player_id: str('player_id'),
    team_id: str('team_id'),
    season_id: str('season_id'),
    period: str('period'),
    score_tecnica_tactica: num('score_tecnica_tactica'),
    score_fisica: num('score_fisica'),
    score_psicologica: num('score_psicologica'),
    score_social: num('score_social'),
    comment_tecnica_tactica: txt('comment_tecnica_tactica'),
    comment_fisica: txt('comment_fisica'),
    comment_psicologica: txt('comment_psicologica'),
    comment_social: txt('comment_social'),
    comment_overall: txt('comment_overall'),
  };

  const parsed = upsertDevelopmentReportSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const d = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // ¿Existe ya el informe de este periodo? (UNIQUE player_id,season_id,period)
  const { data: existing } = await supabase
    .from('development_reports')
    .select('id')
    .eq('player_id', d.player_id)
    .eq('season_id', d.season_id)
    .eq('period', d.period)
    .maybeSingle();

  const scores = {
    score_tecnica_tactica: d.score_tecnica_tactica,
    score_fisica: d.score_fisica,
    score_psicologica: d.score_psicologica,
    score_social: d.score_social,
    comment_tecnica_tactica: d.comment_tecnica_tactica,
    comment_fisica: d.comment_fisica,
    comment_psicologica: d.comment_psicologica,
    comment_social: d.comment_social,
    comment_overall: d.comment_overall,
  };

  if (existing?.id) {
    // No se toca visibility (compartir = 13.10d).
    const { error } = await supabase
      .from('development_reports')
      .update(scores)
      .eq('id', existing.id);
    if (error) return { error: mapPgErr(error.code) };
  } else {
    const { error } = await supabase.from('development_reports').insert({
      club_id: ctx.activeClub.club.id, // el trigger lo deriva igualmente
      team_id: d.team_id,
      player_id: d.player_id,
      season_id: d.season_id,
      period: d.period,
      visibility: 'staff', // nace borrador (compartir = 13.10d)
      created_by: ctx.user.id, // el trigger lo fuerza igualmente
      ...scores,
    });
    if (error) return { error: mapPgErr(error.code) };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${d.player_id}/informes`, 'page');
  revalidatePath(
    `/[locale]/(authenticated)/jugadores/${d.player_id}/informes/${d.period}`,
    'page',
  );
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
