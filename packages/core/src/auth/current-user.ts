import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  createSupabaseServerClient,
  type CookieAdapter,
} from '../supabase/client-server';
import type { Database } from '../supabase/types';

/** Cliente supabase-js tipado con el schema del proyecto. */
type DbClient = SupabaseClient<Database>;

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
    /**
     * O2-1a — color de marca del club en hex #RRGGBB (null = sin color → neutro).
     * OPCIONAL: lo rellena la carga desde memberships (getCurrentUserClubs*), pero
     * el club SINTÉTICO del modo superadmin (F14B-8, apps/web) lo omite. Aditivo:
     * no rompe a los consumidores existentes de apps/web.
     */
    primary_color?: string | null;
  };
};

/**
 * Query única de los clubs del usuario a partir de un `SupabaseClient` ya
 * autenticado. Factorizada para que la variante con `CookieAdapter` (apps/web) y
 * la variante con cliente directo (apps/native) compartan EXACTAMENTE el mismo
 * select/derivación/orden. O2-1a: el select incluye `primary_color`.
 */
async function fetchUserClubs(
  supabase: DbClient,
  userId: string
): Promise<CurrentUserClub[]> {
  const { data, error } = await supabase
    .from('memberships')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, role, club:club_id(id, name, slug, owner_profile_id, logo_path, primary_color)' as any)
    .eq('profile_id', userId)
    // Baja de miembros (paso 3): una membership de baja (left_at no nulo) ya no da
    // acceso — la RLS (paso 2) le niega los datos; aquí, además, se cae de la LISTA
    // de clubes para que no vea la carcasa vacía de un club al que ya no pertenece.
    // Para un miembro ACTIVO (left_at NULL) es un no-op: cero cambio de comportamiento.
    .is('left_at', null);

  if (error || !data) return [];

  type Row = {
    id: string;
    role: Role;
    club: {
      id: string;
      name: string;
      slug: string;
      owner_profile_id: string | null;
      logo_path: string | null;
      primary_color: string | null;
    } | null;
  };

  return (data as unknown as Row[])
    .filter((m): m is Row & { club: NonNullable<Row['club']> } => m.club !== null)
    .map((m) => ({
      membershipId: m.id,
      role: m.role,
      // Booleano derivado; no se propaga owner_profile_id fuera de aquí.
      isOwner: m.club.owner_profile_id === userId,
      club: {
        id: m.club.id,
        name: m.club.name,
        slug: m.club.slug,
        logo_path: m.club.logo_path,
        primary_color: m.club.primary_color,
      },
    }))
    .sort((a, b) => a.club.name.localeCompare(b.club.name));
}

/**
 * Devuelve el `User` autenticado actual a partir de un `SupabaseClient` (variante
 * agnóstica para apps/native). Usa `auth.getUser()` (verifica contra el servidor
 * de Auth), no `getSession()`.
 */
export async function getCurrentUserFromClient(
  supabase: DbClient
): Promise<User | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Lista los clubs del usuario a partir de un `SupabaseClient` (variante agnóstica
 * para apps/native). Misma query/orden que la versión con adapter.
 */
export async function getCurrentUserClubsFromClient(
  supabase: DbClient
): Promise<CurrentUserClub[]> {
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return [];
  return fetchUserClubs(supabase, user.id);
}

/**
 * ¿El usuario actual es SEGUIDOR (espectador)? Wrapper de la RPC `is_spectator`
 * sobre un `SupabaseClient` directo. Detección para apps/native (PR-1); el shell
 * del seguidor lo monta PR-2. En apps/web la detección vive en spectator-shell.ts.
 */
export async function isSpectatorFromClient(
  supabase: DbClient
): Promise<boolean> {
  const { data } = await supabase.rpc('is_spectator');
  return data === true;
}

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
  return getCurrentUserFromClient(createSupabaseServerClient(cookieAdapter));
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
  return getCurrentUserClubsFromClient(createSupabaseServerClient(cookieAdapter));
}
