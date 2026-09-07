import type { SupabaseClient } from '@supabase/supabase-js';
import { reportDataError } from '@/lib/report-error';

/**
 * F14J-5A — Lectura del directorio PÚBLICO de clubes, sin sesión.
 *
 * Las dos RPC (`list_public_clubs`, `get_public_club_by_slug`) son
 * `security definer` y están concedidas a `anon`, así que funcionan con la anon
 * key y nada más. `list_public_clubs` ya excluye en el servidor los clubes con
 * `is_public = false` (paso 1, mig 20261056000000): la app NO filtra nada.
 *
 * POR QUÉ ESTO DEVUELVE UN RESULTADO Y NO UN ARRAY
 * ------------------------------------------------
 * Ésta es la trampa de la pantalla, y por eso el tipo es explícito.
 *
 * La tabla `clubs` está cerrada a `anon` por RLS. Un SELECT directo sin sesión
 * no da 401: da **200 con lista vacía**. Si esta capa devolviera `Club[]`, un
 * fallo de permisos, un fallo de red mal tragado o un despliegue con la RPC
 * caída se pintarían todos como «todavía no hay clubes» — una frase tranquila
 * que describe algo que no ha pasado, y que además impide al usuario entrar sin
 * darle ni una pista de por qué.
 *
 * Así que se distinguen los tres estados en el tipo, y quien pinta la pantalla
 * está OBLIGADO a decidir qué hace con cada uno:
 *
 *     { ok: true,  clubs: [...] }   hay clubes
 *     { ok: true,  clubs: []    }   la consulta fue bien y no hay ninguno
 *     { ok: false }                 no se ha podido saber → error, con reintento
 *
 * `postgrest-js` no lanza nunca: devuelve `{ data, error }`. El bug clásico de
 * esta casa es tirar ese `error` al suelo. Aquí se mira, se reporta y se
 * convierte en `ok: false`.
 */

export type PublicClub = {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
};

export type PublicClubsResult =
  | { ok: true; clubs: PublicClub[] }
  | { ok: false };

export type PublicClubResult =
  | { ok: true; club: PublicClub }
  /** La consulta fue bien y ese slug no existe. Es distinto de un fallo. */
  | { ok: true; club: null }
  | { ok: false };

/** Directorio público completo, ordenado por nombre desde el servidor. */
export async function listPublicClubs(
  supabase: SupabaseClient
): Promise<PublicClubsResult> {
  const { data, error } = await supabase.rpc('list_public_clubs');

  if (error) {
    reportDataError('public-clubs-list', error);
    return { ok: false };
  }
  // `data` nulo sin error no debería ocurrir, pero si ocurre NO es una lista
  // vacía: es que no sabemos. Se trata como fallo, no como directorio vacío.
  if (!data) {
    reportDataError('public-clubs-list', new Error('sin datos y sin error'));
    return { ok: false };
  }

  return { ok: true, clubs: data as PublicClub[] };
}

/**
 * Un club por su slug, para la pantalla de acceso del club recordado.
 *
 * OJO: esta RPC **no** filtra por `is_public`, y es deliberado (ver la cabecera
 * de la migración 20261056000000). Un club fuera del directorio sigue siendo
 * alcanzable por su slug. Consecuencia para esta pantalla: si alguien eligió un
 * club y luego el club sale del directorio, su acceso recordado SIGUE
 * funcionando. Solo se le devuelve al selector si el club ya no existe.
 */
export async function getPublicClubBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<PublicClubResult> {
  const { data, error } = await supabase.rpc('get_public_club_by_slug', {
    p_slug: slug,
  });

  if (error) {
    reportDataError('public-clubs-by-slug', error);
    return { ok: false };
  }
  if (!data) {
    reportDataError('public-clubs-by-slug', new Error('sin datos y sin error'));
    return { ok: false };
  }

  const rows = data as PublicClub[];
  // 0 filas con la consulta OK = ese club ya no existe. No es un fallo: es una
  // respuesta, y la pantalla la usa para olvidar el club recordado.
  return { ok: true, club: rows[0] ?? null };
}
