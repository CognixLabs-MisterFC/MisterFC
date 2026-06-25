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
import { getTranslations } from 'next-intl/server';
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

  revalidateTeamInformes(d.team_id);
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
      // visibility NO se toca al editar: publicar/despublicar es acción aparte
      // (setReportVisibility, F13.10d) para no cambiar el estado de compartido sin querer.
      .update({ scores: d.scores, comment_overall: d.comment_overall })
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
  revalidateTeamInformes(d.team_id);
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

/** Panel de informes a nivel equipo (el estado por fila depende de las scores). */
function revalidateTeamInformes(teamId: string) {
  revalidatePath(`/[locale]/(authenticated)/equipos/${teamId}/informes`, 'page');
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
    review_comment: txtOrNull(formData, 'review_comment'),
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
    // created_period es inmutable → solo title/description/review_comment/status.
    const { error } = await supabase
      .from('player_objectives')
      .update({
        title: d.title,
        description: d.description,
        review_comment: d.review_comment,
        status: d.status,
      })
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
      review_comment: d.review_comment,
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
    review_comment: txtOrNull(formData, 'review_comment'),
    status: strField(formData, 'status'),
    created_period: strField(formData, 'created_period'),
  };
  const parsed = upsertTeamObjectiveSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const d = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (d.id) {
    // created_period es inmutable → solo title/description/review_comment/status.
    const { error } = await supabase
      .from('team_objectives')
      .update({
        title: d.title,
        description: d.description,
        review_comment: d.review_comment,
        status: d.status,
      })
      .eq('id', d.id);
    if (error) return { error: mapPgErr(error.code) };
  } else {
    const { error } = await supabase.from('team_objectives').insert({
      club_id: ctx.activeClub.club.id, // el trigger lo deriva igualmente
      team_id: d.team_id,
      season_id: d.season_id,
      title: d.title,
      description: d.description,
      review_comment: d.review_comment,
      status: d.status,
      created_period: d.created_period,
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

// ── Compartir con la familia (F13.10d): publicar/despublicar + notificar ─────────

export type PublishState = {
  error?: 'invalid' | 'forbidden' | 'generic';
  success?: boolean;
  visibility?: 'staff' | 'team';
};

/** Notifica a las cuentas (familia/jugador) del jugador que su informe se publicó.
 *  Re-notifica en cada publicación (token por publicación) con dedupe (molde 13.6). */
async function notifyReportPublished(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  playerId: string,
  reportId: string,
  period: string,
  locale: string,
  nowMs: number,
): Promise<void> {
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('profile_id')
    .eq('player_id', playerId);
  const recipients = Array.from(
    new Set((pas ?? []).map((r) => r.profile_id).filter(Boolean)),
  ) as string[];
  if (recipients.length === 0) return;

  const t = await getTranslations({ locale, namespace: 'informes.notify' });
  const tPeriod = await getTranslations({ locale, namespace: 'informes.period' });
  const periodLabel = tPeriod(period as 'inicial');
  const title = t('title');
  const body = t('body', { period: periodLabel });
  const deepLink = `/${locale}/mi-ficha?player=${playerId}`;

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipients.map((u) => ({ user_id: u })),
    {
      type: 'development_report_published',
      in_app_payload: { player_id: playerId, report_id: reportId, deep_link: deepLink },
      push_payload: { title, body, deep_link: deepLink, tag: `devreport:${reportId}` },
      dedupe_base_prefix: `development_report_published:${reportId}:${nowMs}`,
    },
  );
}

/** Publica (visibility='team') o despublica ('staff') un informe individual.
 *  Al publicar, notifica a la familia/jugador. Gate real = RLS (update). */
export async function setReportVisibility(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const id = strField(formData, 'id');
  const playerId = strField(formData, 'player_id');
  const period = strField(formData, 'period');
  const locale = strField(formData, 'locale') || 'es';
  const visibility = strField(formData, 'visibility');
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    (visibility !== 'team' && visibility !== 'staff')
  ) {
    return { error: 'invalid' };
  }

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('development_reports')
    .update({ visibility })
    .eq('id', id);
  if (error) return { error: mapPgErr(error.code) };

  if (visibility === 'team') {
    // nowMs inyectado por la action (no Date.now en módulo) — re-notifica por publicación.
    await notifyReportPublished(supabase, playerId, id, period, locale, Date.now());
  }

  revalidateInformes(playerId);
  return { success: true, visibility };
}
