import type { User } from '@supabase/supabase-js';
import {
  createSupabaseServerClient,
  type CookieAdapter,
} from '../supabase/client-server';

export type Role =
  | 'admin_club'
  | 'coordinador'
  | 'entrenador_principal'
  | 'entrenador_ayudante'
  | 'jugador';

export type CurrentUserClub = {
  membershipId: string;
  role: Role;
  club: {
    id: string;
    name: string;
    slug: string;
  };
};

/**
 * Devuelve el `User` autenticado actual o `null` si no hay sesión.
 *
 * Usa `supabase.auth.getUser()` (no `getSession()`) porque getUser hace
 * verificación contra el servidor de Auth — necesario en SSR para no
 * confiar en cookies que podrían estar manipuladas.
 */
export async function getCurrentUser(
  cookieAdapter: CookieAdapter
): Promise<User | null> {
  const supabase = createSupabaseServerClient(cookieAdapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Lista los clubs en los que el user actual tiene una membership.
 *
 * Devuelve `[]` si no hay sesión o si el user no tiene memberships.
 * El orden es estable por `clubs.name` para que la UI no se reordene en cada render.
 */
export async function getCurrentUserClubs(
  cookieAdapter: CookieAdapter
): Promise<CurrentUserClub[]> {
  const supabase = createSupabaseServerClient(cookieAdapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('memberships')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, role, club:club_id(id, name, slug)' as any)
    .eq('profile_id', user.id);

  if (error || !data) return [];

  // El tipo de `Database` es aún placeholder (se rellena en 1.7), por eso el cast.
  type Row = {
    id: string;
    role: Role;
    club: { id: string; name: string; slug: string } | null;
  };

  return (data as unknown as Row[])
    .filter((m): m is Row & { club: NonNullable<Row['club']> } => m.club !== null)
    .map((m) => ({
      membershipId: m.id,
      role: m.role,
      club: m.club,
    }))
    .sort((a, b) => a.club.name.localeCompare(b.club.name));
}
