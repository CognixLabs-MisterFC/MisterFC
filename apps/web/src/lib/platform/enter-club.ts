'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  createSupabaseServerClient,
  createSupabaseAdminClient,
  getCurrentUser,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 año (igual que setActiveClub)

/**
 * F14B-8 — El superadmin ENTRA a un club ajeno desde la consola. Fija la cookie
 * de club activo al club elegido y audita la entrada como acción de plataforma.
 * Dentro del club, el shell lo trata como el admin/owner único (role admin_club,
 * isOwner TRUE — verdad tras RM-2). Al owner real NO lo puede descabezar
 * (profile_is_club_owner lo protege, RM-2).
 *
 * Gate is_superadmin() + el club existe. NO crea membership. NO toca RLS/roles
 * (RM-1/RM-2 ya dejaron el modelo listo; el acceso lo da el chokepoint F14B-2).
 */
export async function enterClubAsSuperadmin(
  clubId: string,
  locale: string,
): Promise<{ error: 'no_session' | 'forbidden' | 'club_not_found' } | void> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const user = await getCurrentUser(adapter);
  if (!user) return { error: 'no_session' };

  const { data: isSuper } = await supabase.rpc('is_superadmin');
  if (isSuper !== true) return { error: 'forbidden' };

  // El club debe existir (el superadmin lo lee por RLS vía chokepoint).
  const { data: clubRow } = await supabase
    .from('clubs')
    .select('id')
    .eq('id', clubId)
    .maybeSingle();
  if (!clubRow) return { error: 'club_not_found' };

  // Fija la cookie de club activo → loadShellContext fabricará el club sintético.
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLUB_COOKIE_NAME, clubId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  // AUDITORÍA (acción de plataforma). audit_log no tiene policy de INSERT (RLS) →
  // se escribe con el cliente admin (service_role). action es texto libre (sin
  // CHECK) → no requiere migración. Best-effort: un fallo de auditoría no debe
  // bloquear la entrada, pero se reporta a Sentry.
  try {
    const admin = createSupabaseAdminClient();
    const { error: auditErr } = await admin.from('audit_log').insert({
      actor_profile_id: user.id,
      action: 'platform.club_enter',
      target_kind: 'club',
      target_id: clubId,
      club_id: clubId,
      reason: 'Acceso de superadmin al club',
    });
    if (auditErr) {
      console.error(
        '[platform][enter-club] audit_failed ' +
          JSON.stringify({ club_id: clubId, error: auditErr.message }),
      );
      Sentry.captureException(auditErr, {
        tags: { feature: 'platform', step: 'audit_club_enter' },
      });
    }
  } catch (thrown) {
    console.error('[platform][enter-club] audit_thrown', { club_id: clubId });
    Sentry.captureException(thrown, {
      tags: { feature: 'platform', step: 'audit_club_enter_thrown' },
    });
  }

  redirect(`/${locale}`);
}
