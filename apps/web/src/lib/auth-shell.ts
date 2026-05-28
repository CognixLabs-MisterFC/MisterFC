import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  createSupabaseServerClient,
  getCurrentUser,
  getCurrentUserClubs,
  resolveActiveClub,
  type CurrentUserClub,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type ShellProfile = {
  full_name: string | null;
  avatar_url: string | null;
  date_of_birth: string | null;
  locale: string;
};

export type ShellContext = {
  user: User;
  profile: ShellProfile;
  clubs: CurrentUserClub[];
  activeClub: CurrentUserClub;
  staleCookie: boolean;
};

/**
 * Carga el contexto que necesita el shell autenticado:
 *   - User actual (verificado).
 *   - Profile (full_name, avatar_url, locale).
 *   - Lista de clubs del user.
 *   - Club activo (cookie `active_club_id` con fallback).
 *
 * Devuelve null si falta cualquier requisito: sin sesión, sin clubs, etc.
 * El llamador decide si redirigir a /signin o /onboarding.
 */
export async function loadShellContext(): Promise<ShellContext | null> {
  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) return null;

  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length === 0) return null;

  const supabase = createSupabaseServerClient(adapter);
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, date_of_birth, locale')
    .eq('id', user.id)
    .maybeSingle();

  const profile: ShellProfile = {
    full_name: profileRow?.full_name ?? null,
    avatar_url: profileRow?.avatar_url ?? null,
    date_of_birth: profileRow?.date_of_birth ?? null,
    locale: profileRow?.locale ?? 'es',
  };

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null;

  const { active, staleCookie } = resolveActiveClub(clubs, cookieValue);
  if (!active) return null;

  return { user, profile, clubs, activeClub: active, staleCookie };
}

/**
 * Versión "loose" para `/onboarding`: el user puede estar autenticado sin clubs.
 * Devuelve null solo si no hay sesión.
 */
export async function loadAuthOnly(): Promise<{
  user: User;
  profile: ShellProfile;
} | null> {
  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) return null;

  const supabase = createSupabaseServerClient(adapter);
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, date_of_birth, locale')
    .eq('id', user.id)
    .maybeSingle();

  return {
    user,
    profile: {
      full_name: profileRow?.full_name ?? null,
      avatar_url: profileRow?.avatar_url ?? null,
      date_of_birth: profileRow?.date_of_birth ?? null,
      locale: profileRow?.locale ?? 'es',
    },
  };
}
