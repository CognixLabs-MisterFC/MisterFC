'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_PLAYER_COOKIE_NAME,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 año

/**
 * F14C-4 — Fija el "nieto activo" del seguidor.
 *
 * Valida que el seguidor REALMENTE sigue a ese jugador antes de escribir la
 * cookie: consulta `player_spectators` (RLS: solo filas propias). Un id ajeno
 * no escribe nada. La RLS sigue siendo la autoridad real; esto es UX.
 */
export async function setActivePlayer(playerId: string): Promise<void> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return;

  const { data: row } = await supabase
    .from('player_spectators')
    .select('player_id')
    .eq('spectator_profile_id', user.user.id)
    .eq('player_id', playerId)
    .maybeSingle();
  if (!row) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PLAYER_COOKIE_NAME, playerId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  revalidatePath('/', 'layout');
}

/**
 * Re-escribe la cookie del nieto activo cuando resolveActivePlayer detecta que
 * apuntaba a un jugador que ya no sigue (staleCookie=true). Idempotente.
 */
export async function rewriteStaleActivePlayer(playerId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PLAYER_COOKIE_NAME, playerId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}
