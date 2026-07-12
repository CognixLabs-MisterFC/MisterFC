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
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

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
 * F14B-9a — Fija (path) o quita (null) el logo del club. La autoridad la impone la
 * RPC `set_club_logo` (gate admin_club; excluye director, incluye superadmin por el
 * chokepoint). El objeto ya se subió al bucket `club-logos` desde el cliente (la
 * policy de storage vuelve a exigir admin_club).
 */
export async function setClubLogo(
  clubId: string,
  path: string | null,
): Promise<ActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('set_club_logo', {
    p_club_id: clubId,
    p_path: path,
  });
  if (error) {
    return {
      error: error.message?.includes('forbidden') ? 'forbidden' : 'generic',
    };
  }

  revalidatePath('/[locale]/(authenticated)/ajustes', 'page');
  revalidatePath('/[locale]/(authenticated)', 'layout');
  return { success: true };
}
