'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  getCurrentUserClubs,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 año

/**
 * Marca un club como activo para el user actual.
 *
 * Valida que el user pertenece al club antes de aceptar el cambio: si la
 * cookie es manipulada o llega un id ajeno, no escribimos nada. La RLS
 * sigue siendo la autoridad de seguridad real; esto es UX.
 */
export async function setActiveClub(clubId: string): Promise<void> {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  if (!clubs.some((c) => c.club.id === clubId)) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLUB_COOKIE_NAME, clubId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  revalidatePath('/', 'layout');
}

/**
 * Re-escribe la cookie de club activo cuando el resolveActiveClub detecta
 * que apuntaba a un club inválido (staleCookie=true). Idempotente.
 */
export async function rewriteStaleActiveClub(clubId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLUB_COOKIE_NAME, clubId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}
