'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

export type ReconsentState = { error?: string };

type ChildDecision = { internal?: boolean; social?: boolean; medical?: boolean };

/**
 * F14-5 — Envío de la pantalla de re-consentimiento. Delega TODO en la RPC
 * `record_season_reconsent` (SECURITY DEFINER, atómica): obligatorios (T&C +
 * Privacidad) sellados a la temporada activa + opcionales DECIDIDOS por hijo. Los
 * opcionales "sin cambios" no viajan → siguen vigentes los de la temporada previa.
 * ip/user_agent se capturan server-side (no se confía en el cliente).
 */
export async function submitReconsent(
  _prev: ReconsentState,
  formData: FormData,
): Promise<ReconsentState> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'no_session' };
  const clubId = ctx.activeClub.club.id;
  const locale = (formData.get('locale') as string) || ctx.profile.locale || 'es';

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const acceptTerms = formData.get('accept_terms') === 'true';
  const acceptPrivacy = formData.get('accept_privacy') === 'true';

  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  const ip = fwd ? (fwd.split(',')[0]?.trim() ?? null) : null;
  const userAgent = h.get('user-agent');

  // Decisiones por hijo: radios `reconsent_<tipo>_<pid>` con valor yes|no|unset.
  // Solo yes/no generan clave (el servidor solo inserta lo decidido).
  const decide = (raw: FormDataEntryValue | null): boolean | undefined =>
    raw === 'yes' ? true : raw === 'no' ? false : undefined;

  const pids = new Set<string>();
  for (const key of formData.keys()) {
    const m = /^reconsent_(?:internal|social|medical)_(.+)$/.exec(key);
    if (m?.[1]) pids.add(m[1]);
  }

  const children: Record<string, ChildDecision> = {};
  for (const pid of pids) {
    const entry: ChildDecision = {};
    const internal = decide(formData.get(`reconsent_internal_${pid}`));
    const social = decide(formData.get(`reconsent_social_${pid}`));
    const medical = decide(formData.get(`reconsent_medical_${pid}`));
    if (internal !== undefined) entry.internal = internal;
    if (social !== undefined) entry.social = social;
    if (medical !== undefined) entry.medical = medical;
    if (Object.keys(entry).length > 0) children[pid] = entry;
  }

  const { error } = await supabase.rpc('record_season_reconsent', {
    p_club_id: clubId,
    p_accept_terms: acceptTerms,
    p_accept_privacy: acceptPrivacy,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
    p_children: children,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('consent_required')) return { error: 'consent_required' };
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    return { error: 'generic' };
  }

  // Consentido para la temporada activa → el gate ya no dispara. Volver a la app.
  redirect(`/${locale}`);
}
