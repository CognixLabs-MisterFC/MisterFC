'use server';

/**
 * F8.5 — Ajustes del club. Primer ajuste: visibilidad de valoraciones de partido
 * para jugador/familia (club_settings.evaluations_player_visibility, opt-in D4).
 *
 * La autoridad la impone la RLS de club_settings (policy `club_settings_write`,
 * solo admin_club, D10): aquí no re-chequeamos rol, dejamos que la policy rechace
 * (42501 → 'forbidden'). El coordinador ve la pantalla pero el control llega
 * deshabilitado, así que no debería llamar a la action.
 */

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  createSupabaseServerClient,
  getCurrentUserClubs,
  resolveActiveClub,
  setEvaluationsVisibilitySchema,
  setAssessmentDeadlineSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

type ActionResult = { success?: boolean; error?: string };

async function activeClubId(): Promise<string | null> {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null;
  const { active } = resolveActiveClub(clubs, cookieValue);
  return active?.club.id ?? null;
}

export async function setEvaluationsVisibility(
  input: unknown,
): Promise<ActionResult> {
  const parsed = setEvaluationsVisibilitySchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { visible } = parsed.data;

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Upsert: crea la fila del club si aún no existe (sin fila = OFF). El trigger
  // de updated_at se encarga del timestamp; no hay campos inmutables aquí.
  const { error } = await supabase
    .from('club_settings')
    .upsert(
      { club_id: clubId, evaluations_player_visibility: visible },
      { onConflict: 'club_id' },
    );
  if (error) {
    return { error: error.code === '42501' ? 'forbidden' : 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/ajustes', 'page');
  return { success: true };
}

/**
 * F13.10g-0 — Fija (o borra, due_date vacío/null) la fecha límite de un periodo de
 * la temporada. La autoridad la impone la RLS de assessment_deadlines (escritura
 * solo admin_club → 42501 → 'forbidden'). El trigger fuerza club_id/created_by.
 */
export async function setAssessmentDeadline(input: unknown): Promise<ActionResult> {
  const parsed = setAssessmentDeadlineSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { season_id, period, due_date } = parsed.data;

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (due_date === null) {
    // Borrar la fecha del periodo (vuelve a "sin fecha").
    const { error } = await supabase
      .from('assessment_deadlines')
      .delete()
      .eq('season_id', season_id)
      .eq('period', period);
    if (error) return { error: error.code === '42501' ? 'forbidden' : 'generic' };
  } else {
    // Upsert por (season_id, period). club_id/created_by los deriva/fuerza el trigger.
    const { error } = await supabase.from('assessment_deadlines').upsert(
      {
        club_id: ctx.activeClub.club.id,
        season_id,
        period,
        due_date,
        created_by: ctx.user.id,
      },
      { onConflict: 'season_id,period' },
    );
    if (error) return { error: error.code === '42501' ? 'forbidden' : 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/ajustes', 'page');
  return { success: true };
}
