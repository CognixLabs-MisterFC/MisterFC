'use server';

/**
 * F13.10g-GB — Acciones del centro de mando de campañas (admin/coord).
 *  - setCampaignDeadline: fija/borra la due_date de la campaña del periodo (upsert).
 *  - launchCampaign: draft→launched + launched_at, y avisa a los entrenadores con
 *    equipos (fan-out evaluation_campaign_launched). La autoridad la impone la RLS
 *    de assessment_campaigns (escritura solo admin_club → 42501 → 'forbidden').
 */

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  createSupabaseServerClient,
  isDevelopmentPeriod,
  upsertAssessmentCampaignSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

type ActionResult = { error?: 'invalid' | 'forbidden' | 'no_campaign' | 'generic'; success?: boolean };

function mapErr(code: string | undefined): 'forbidden' | 'generic' {
  return code === '42501' ? 'forbidden' : 'generic';
}

function revalidate() {
  revalidatePath('/[locale]/(authenticated)/plantilla/informes', 'page');
}

/** Fija (o borra con due_date vacío) la fecha límite de la campaña del periodo. */
export async function setCampaignDeadline(input: unknown): Promise<ActionResult> {
  const parsed = upsertAssessmentCampaignSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { season_id, period, due_date } = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const supabase = createSupabaseServerClient(await createCookieAdapter());

  if (due_date === null) {
    const { error } = await supabase
      .from('assessment_campaigns')
      .delete()
      .eq('season_id', season_id)
      .eq('period', period);
    if (error) return { error: mapErr(error.code) };
  } else {
    const { error } = await supabase.from('assessment_campaigns').upsert(
      {
        club_id: ctx.activeClub.club.id, // trigger lo deriva igualmente
        season_id,
        period,
        due_date,
        created_by: ctx.user.id, // trigger lo fuerza igualmente
      },
      { onConflict: 'season_id,period' },
    );
    if (error) return { error: mapErr(error.code) };
  }

  revalidate();
  return { success: true };
}

/** Lanza la campaña del periodo (draft→launched) y avisa a los entrenadores. */
export async function launchCampaign(input: unknown): Promise<ActionResult> {
  const data = (input ?? {}) as { season_id?: string; period?: string; locale?: string };
  const seasonId = String(data.season_id ?? '');
  const period = String(data.period ?? '');
  const locale = String(data.locale ?? 'es');
  if (!/^[0-9a-f-]{36}$/i.test(seasonId) || !isDevelopmentPeriod(period)) {
    return { error: 'invalid' };
  }

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const clubId = ctx.activeClub.club.id;

  // La campaña debe existir y tener fecha antes de lanzar.
  const { data: campaign } = await supabase
    .from('assessment_campaigns')
    .select('id, status, due_date')
    .eq('season_id', seasonId)
    .eq('period', period)
    .maybeSingle();
  if (!campaign || !campaign.due_date) return { error: 'no_campaign' };

  // draft→launched (guard del trigger respeta el resto). Idempotente: solo desde draft.
  const { data: updated, error } = await supabase
    .from('assessment_campaigns')
    .update({ status: 'launched', launched_at: new Date().toISOString() })
    .eq('id', campaign.id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();
  if (error) return { error: mapErr(error.code) };
  if (!updated) {
    // Ya no estaba en draft (lanzada/publicada): nada que hacer, sin re-notificar.
    revalidate();
    return { success: true };
  }

  await notifyCoachesLaunched(supabase, clubId, seasonId, period, campaign.due_date as string, locale);

  revalidate();
  return { success: true };
}

/** Fan-out a los entrenadores (team_staff activo) de los equipos de la temporada. */
async function notifyCoachesLaunched(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  clubId: string,
  seasonId: string,
  period: string,
  dueDate: string,
  locale: string,
): Promise<void> {
  // Temporada (label) para acotar los equipos.
  const { data: season } = await supabase
    .from('seasons')
    .select('label')
    .eq('id', seasonId)
    .maybeSingle();
  const seasonLabel = (season?.label as string | undefined) ?? null;
  if (!seasonLabel) return;

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('season', seasonLabel)
    .eq('categories.club_id', clubId);
  const teamIds = ((teamRows ?? []) as unknown as Array<{ id: string }>).map((t) => t.id);
  if (teamIds.length === 0) return;

  const { data: staffRows } = await supabase
    .from('team_staff')
    .select('memberships!inner(profile_id)')
    .in('team_id', teamIds)
    .is('left_at', null)
    .in('staff_role', ['entrenador_principal', 'entrenador_ayudante']);
  const recipients = Array.from(
    new Set(
      ((staffRows ?? []) as unknown as Array<{ memberships: { profile_id: string } }>)
        .map((r) => r.memberships?.profile_id)
        .filter(Boolean),
    ),
  ) as string[];
  if (recipients.length === 0) return;

  const t = await getTranslations({ locale, namespace: 'informes.campaign_alert' });
  const tPeriod = await getTranslations({ locale, namespace: 'informes.period' });
  const periodLabel = tPeriod(period as 'inicial');
  const dueLabel = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(new Date(`${dueDate}T00:00:00Z`));
  const title = t('notify_title', { period: periodLabel });
  const body = t('notify_body', { period: periodLabel, date: dueLabel });
  const deepLink = `/${locale}/mis-equipos`;

  const { emitNotificationFanOut } = await import('@/lib/notify-bus');
  await emitNotificationFanOut(
    recipients.map((u) => ({ user_id: u })),
    {
      type: 'evaluation_campaign_launched',
      in_app_payload: { period, due_date: dueDate, deep_link: deepLink },
      push_payload: { title, body, deep_link: deepLink, tag: `campaign:${seasonId}:${period}` },
      dedupe_base_prefix: `evaluation_campaign_launched:${seasonId}:${period}`,
    },
  );
}
