import type { User } from '@supabase/supabase-js';
import {
  createSupabaseServerClient,
  type CookieAdapter,
} from '../supabase/client-server';

export type Role =
  | 'admin_club'
  | 'director'
  | 'coordinador'
  | 'entrenador_principal'
  | 'entrenador_ayudante'
  | 'jugador';

export type CurrentUserClub = {
  membershipId: string;
  role: Role;
  /**
   * F1B — el usuario actual es el OWNER de este club (clubs.owner_profile_id ===
   * su profile). Solo el owner gestiona directores/admins (gate real server-side
   * en F1B-2/2b; esto es para condicionar la UI). Booleano derivado: NUNCA se
   * expone owner_profile_id crudo al front.
   */
  isOwner: boolean;
  /**
   * F14B-8 — true si este club es un acceso SINTÉTICO de "modo superadmin" (el
   * superadmin entró a un club ajeno desde la consola), NO una membership real.
   * Ausente/false para las membresías normales. Lo usa el shell para pintar el
   * banner de modo superadmin. Nunca se persiste: se deriva por request.
   */
  isPlatformAccess?: boolean;
  club: {
    id: string;
    name: string;
    slug: string;
    /** F14B-9a — path del logo en el bucket público `club-logos`; null si sin logo. */
    logo_path: string | null;
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
    .select('id, role, club:club_id(id, name, slug, owner_profile_id, logo_path)' as any)
    .eq('profile_id', user.id);

  if (error || !data) return [];

  // El tipo de `Database` es aún placeholder (se rellena en 1.7), por eso el cast.
  type Row = {
    id: string;
    role: Role;
    club: {
      id: string;
      name: string;
      slug: string;
      owner_profile_id: string | null;
      logo_path: string | null;
    } | null;
  };

  return (data as unknown as Row[])
    .filter((m): m is Row & { club: NonNullable<Row['club']> } => m.club !== null)
    .map((m) => ({
      membershipId: m.id,
      role: m.role,
      // Booleano derivado; no se propaga owner_profile_id fuera de aquí.
      isOwner: m.club.owner_profile_id === user.id,
      club: {
        id: m.club.id,
        name: m.club.name,
        slug: m.club.slug,
        logo_path: m.club.logo_path,
      },
    }))
    .sort((a, b) => a.club.name.localeCompare(b.club.name));
}
