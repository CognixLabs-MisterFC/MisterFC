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
/** F14B-8 — membershipId sintético del club de "modo superadmin" (UUID cero: es
 *  UUID válido y no casa ninguna fila real → las queries por membership salen
 *  vacías, sin crashear). */
const PLATFORM_ACCESS_MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000000';

export async function loadShellContext(): Promise<ShellContext | null> {
  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) return null;

  const supabase = createSupabaseServerClient(adapter);
  const clubs = await getCurrentUserClubs(adapter);

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null;

  // F14B-8 — SUPERADMIN entrando a un club AJENO: si la cookie apunta a un club
  // que NO está en sus membresías reales y es superadmin, fabricamos un
  // CurrentUserClub SINTÉTICO (role admin_club, isOwner TRUE — verdad tras RM-2 —
  // membershipId cero, marca isPlatformAccess). Así resolveActiveClub casa la
  // cookie y el shell no rebota a onboarding. Para el resto de usuarios NO se
  // ejecuta nada de esto (comportamiento idéntico a hoy). La RPC is_superadmin
  // solo se llama cuando la cookie apunta fuera de las membresías reales.
  if (cookieValue && !clubs.some((c) => c.club.id === cookieValue)) {
    const { data: isSuper } = await supabase.rpc('is_superadmin');
    if (isSuper === true) {
      // El superadmin puede leer cualquier club por RLS (chokepoint F14B-2 →
      // user_role_in_club='admin_club' → clubs_select_member lo permite).
      const { data: clubRow } = await supabase
        .from('clubs')
        .select('id, name, slug, logo_path')
        .eq('id', cookieValue)
        .maybeSingle();
      if (clubRow) {
        clubs.push({
          membershipId: PLATFORM_ACCESS_MEMBERSHIP_ID,
          role: 'admin_club',
          isOwner: true,
          isPlatformAccess: true,
          club: {
            id: clubRow.id,
            name: clubRow.name,
            slug: clubRow.slug,
            logo_path: clubRow.logo_path,
          },
        });
      }
    }
  }

  if (clubs.length === 0) return null;

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
