import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';

type DbClient = SupabaseClient<Database>;

/**
 * V-2 — PATROCINADORES Y COLABORADORES del club, la lectura y la regla.
 *
 * La tabla y su gate son de V-1 (mig 20261112000000, aplicada). Aquí baja lo que van
 * a necesitar las CUATRO superficies que lo pintan —familia (que cubre jugador),
 * staff, dirección y seguidor— y el CRUD de la web. Baja a core y no a cada pantalla
 * por el motivo de siempre en este repo: `apps/web` no ejecuta ni una prueba, y una
 * regla repetida en cuatro sitios es una regla que nadie comprueba.
 *
 * ── LO QUE NO ES OBVIO, Y ES EL MOTIVO DE QUE ESTO EXISTA ───────────────────
 * La policy de lectura de V-1 filtra `active`, así que un entrenador o un tutor NUNCA
 * recibe un socio retirado. Pero la policy de ESCRITURA (admin_club y director) es
 * permisiva y se suma para el SELECT: un director SÍ ve los retirados, y tiene que
 * verlos para poder reactivarlos.
 *
 * Consecuencia: en las superficies de INICIO no basta con confiar en la RLS. Sin
 * `.eq('active', true)` explícito, el club entero vería dos patrocinadores y el
 * director vería tres — y el tercero es el que se retiró. Por eso el filtro está aquí
 * dentro y no en cada pantalla.
 *
 * El listado del CRUD (que sí quiere los retirados) es otra función y llega con V-4;
 * no se hace aquí para no tener una bandera `incluirRetirados` que alguien acabe
 * pasando en un inicio.
 */

/** Los dos tipos, tal y como los escribe el CHECK de la tabla (en castellano). */
export type PartnerKind = 'patrocinador' | 'colaborador';

/**
 * El orden de este array es el orden en que se pintan las secciones: primero quien
 * paga. Es dato, no cosmética: las cuatro superficies lo recorren en vez de escribir
 * dos bloques a mano.
 */
export const PARTNER_KINDS: readonly PartnerKind[] = ['patrocinador', 'colaborador'];

/** Un socio, ya listo para pintar. */
export type ClubPartner = {
  id: string;
  kind: PartnerKind;
  name: string;
  /** La línea de texto. `null` si el socio no quiso ninguna. */
  tagline: string | null;
  /** URL FIRMADA del logo, o `null` si la firma falló. El bucket es privado. */
  logoUrl: string | null;
  url: string;
};

/**
 * ¿Puede este rol gestionar los socios del club?
 *
 * Es la proyección en pantalla de `user_is_admin_or_director(club_id)`, la misma
 * función que gobierna la policy de escritura. Coincide hoy con `canLinkPlayers` y con
 * el área `direction` de la app, y son decisiones distintas que tienen que poder
 * cambiar por separado: no se unifican.
 *
 * El superadmin no aparece aquí porque no es un rol de club: entra por el chokepoint
 * (`user_role_in_club` le devuelve 'admin_club' en cualquier club), así que quien
 * pregunta por su rol ya recibe 'admin_club'.
 */
export function canManageClubPartners(role: Role | null | undefined): boolean {
  return role === 'admin_club' || role === 'director';
}

function esKindConocido(v: unknown): v is PartnerKind {
  return typeof v === 'string' && (PARTNER_KINDS as readonly string[]).includes(v);
}

/** El bucket privado de V-1. Escrito una vez. */
export const CLUB_PARTNER_LOGOS_BUCKET = 'club-partner-logos';

/**
 * Una hora, igual que las fotos de jugador de las pantallas de convocatoria y directo
 * (`PHOTO_TTL_SECONDS = 3600`). No se pone más corto porque un inicio no se recarga
 * cada diez minutos, ni más largo porque una URL firmada es una llave.
 */
export const CLUB_PARTNER_LOGO_TTL_SECONDS = 3600;

/**
 * Los socios ACTIVOS de un club, ordenados y con el logo ya firmado.
 *
 * ORDEN: `sort_order` y, a igualdad, `created_at`. El desempate no es adorno — dos
 * socios con el mismo `sort_order` saldrían en orden arbitrario, y entonces la misma
 * pantalla se pinta distinta en cada recarga sin que nadie haya tocado nada.
 *
 * UN KIND DESCONOCIDO SE CAE, y avisa. Hoy no puede pasar (el CHECK de la tabla solo
 * admite dos valores), y si un día se añade un tercero, un build viejo que lo pintara
 * bajo el rótulo de «patrocinador» estaría diciendo algo falso de una empresa que
 * paga. Así que se descarta la fila y se llama a `onError`: no se inventa una sección
 * y no se pierde el rastro.
 *
 * SI LA FIRMA FALLA, la fila se queda sin logo en vez de desaparecer: mismo criterio
 * que `image-consent.ts` con las fotos. Un socio con nombre y enlace sigue sirviendo;
 * la pantalla decide si lo pinta.
 */
export async function getClubPartnersFromClient(
  supabase: DbClient,
  clubId: string,
  onError?: (err: unknown, paso: string) => void,
  ttlSeconds: number = CLUB_PARTNER_LOGO_TTL_SECONDS,
): Promise<ClubPartner[]> {
  const { data: rows, error } = await supabase
    .from('club_partners')
    .select('id, kind, name, tagline, logo_path, url')
    .eq('club_id', clubId)
    // Explícito Y NO redundante: la RLS solo filtra `active` para quien no gestiona
    // (ver la cabecera). Sin esto, el director vería los retirados en su inicio.
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    // Un fallo de lectura devuelve lista vacía —el inicio no se rompe por esto— pero
    // deja rastro. Un `[]` mudo es lo que convierte un fallo de RLS en «el club no
    // tiene patrocinadores».
    onError?.(error, 'select');
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const validas = rows.filter((r) => {
    if (esKindConocido(r.kind)) return true;
    onError?.(new Error(`club_partners: kind desconocido '${String(r.kind)}'`), 'kind');
    return false;
  });
  if (validas.length === 0) return [];

  const paths = validas
    .map((r) => r.logo_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);

  const firmadas = new Map<string, string>();
  if (paths.length > 0) {
    const { data: lista, error: firmaErr } = await supabase.storage
      .from(CLUB_PARTNER_LOGOS_BUCKET)
      .createSignedUrls(paths, ttlSeconds);
    if (firmaErr) onError?.(firmaErr, 'sign');
    for (const s of lista ?? []) {
      if (s.path && s.signedUrl) firmadas.set(s.path, s.signedUrl);
    }
  }

  return validas.map((r) => ({
    id: r.id,
    kind: r.kind as PartnerKind,
    name: r.name,
    tagline: r.tagline,
    logoUrl: firmadas.get(r.logo_path) ?? null,
    url: r.url,
  }));
}

/**
 * Reparte una lista en sus dos secciones, en el orden de `PARTNER_KINDS`.
 *
 * Existe para que las cuatro superficies no escriban cuatro veces el mismo `filter`.
 * Devuelve SIEMPRE las dos entradas, aunque estén vacías: así la pantalla decide si
 * pinta la sección mirando `length`, y no hay un `undefined` que recorrer.
 */
export function groupPartnersByKind(
  partners: readonly ClubPartner[],
): Record<PartnerKind, ClubPartner[]> {
  const out = { patrocinador: [] as ClubPartner[], colaborador: [] as ClubPartner[] };
  for (const p of partners) out[p.kind].push(p);
  return out;
}
