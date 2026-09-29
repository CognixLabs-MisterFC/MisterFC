import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';

type DbClient = SupabaseClient<Database>;

/**
 * V-2 — PATROCINADORES Y COLABORADORES del club, la lectura y la regla.
 *
 * La tabla y su gate son de V-1 (mig 20261112000000, aplicada). Aquí baja lo que
 * necesitan las CINCO superficies que lo pintan —los cuatro inicios de la app
 * (familia, que cubre jugador; staff; dirección; seguidor) y el inicio de la web— y
 * el CRUD de la web. Baja a core y no a cada pantalla por el motivo de siempre en
 * este repo: `apps/web` no ejecuta ni una prueba, y una regla repetida en cinco
 * sitios es una regla que nadie comprueba.
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
 * ── LO SEGUNDO QUE NO ES OBVIO (V-3) ───────────────────────────────────────
 * El logo vive en un bucket PRIVADO, así que se pinta con una URL firmada que caduca
 * en una hora. La app nativa guarda en disco lo que lee, para funcionar sin
 * conexión. Las dos cosas juntas no caben: una caché de ayer serviría firmas muertas.
 * Por eso la lectura está PARTIDA en dos —las filas, que se cachean, y la firma, que
 * no— y solo la web usa la función que hace ambas cosas de una vez.
 *
 * El listado del CRUD (que sí quiere los retirados) es otra función y llega con V-4;
 * no se hace aquí para no tener una bandera `incluirRetirados` que alguien acabe
 * pasando en un inicio.
 */

/** Los dos tipos, tal y como los escribe el CHECK de la tabla (en castellano). */
export type PartnerKind = 'patrocinador' | 'colaborador';

/**
 * El orden de este array es el orden en que se pintan las secciones: primero quien
 * paga. Es dato, no cosmética: las cinco superficies lo recorren en vez de escribir
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
 * Una fila de socio TAL CUAL SE GUARDA: con la RUTA del logo, no con su URL firmada.
 *
 * Existe separada de `ClubPartner` por una razón concreta: esto SE PUEDE CACHEAR y
 * una URL firmada NO. La app nativa guarda en disco lo que lee (`useCached`, caché
 * offline), y una firma caduca en una hora; una caché de ayer serviría enlaces
 * muertos y el club aparecería sin logos sin que nadie hubiera tocado nada. Es el
 * mismo reparto que ya hace el repo con las fotos de jugador
 * (`getPlayerPhotoPathFromClient` + `signPlayerPhotoFromClient`): la ruta se guarda,
 * la llave se pide cada vez.
 */
export type ClubPartnerRow = {
  id: string;
  kind: PartnerKind;
  name: string;
  tagline: string | null;
  /** Ruta DENTRO del bucket privado. No es una URL y no sirve para pintar. */
  logoPath: string;
  url: string;
};

/**
 * Los socios ACTIVOS de un club, ordenados, SIN firmar.
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
 */
export async function getClubPartnerRowsFromClient(
  supabase: DbClient,
  clubId: string,
  onError?: (err: unknown, paso: string) => void,
): Promise<ClubPartnerRow[]> {
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

  const salida: ClubPartnerRow[] = [];
  for (const r of rows) {
    if (!esKindConocido(r.kind)) {
      onError?.(new Error(`club_partners: kind desconocido '${String(r.kind)}'`), 'kind');
      continue;
    }
    salida.push({
      id: r.id,
      kind: r.kind,
      name: r.name,
      tagline: r.tagline,
      logoPath: r.logo_path,
      url: r.url,
    });
  }
  return salida;
}

/**
 * Firma UN LOTE de logos y devuelve `ruta → URL firmada`.
 *
 * En lote y no una a una: `createSignedUrls` es una sola llamada para los N logos del
 * club, el mismo patrón que `notifications/image-consent.ts` con las fotos. Un inicio
 * con seis socios haría seis peticiones si se firmara por fila.
 *
 * Lo que no se puede firmar sencillamente NO APARECE en el mapa. Quien pinta decide
 * qué hacer con un socio sin logo; aquí no se inventa una URL ni se tira la fila.
 */
export async function signClubPartnerLogosFromClient(
  supabase: DbClient,
  paths: readonly string[],
  onError?: (err: unknown, paso: string) => void,
  ttlSeconds: number = CLUB_PARTNER_LOGO_TTL_SECONDS,
): Promise<Map<string, string>> {
  const firmadas = new Map<string, string>();
  const limpias = paths.filter((p) => typeof p === 'string' && p.length > 0);
  if (limpias.length === 0) return firmadas;

  const { data: lista, error } = await supabase.storage
    .from(CLUB_PARTNER_LOGOS_BUCKET)
    .createSignedUrls([...limpias], ttlSeconds);
  if (error) onError?.(error, 'sign');
  for (const s of lista ?? []) {
    if (s.path && s.signedUrl) firmadas.set(s.path, s.signedUrl);
  }
  return firmadas;
}

/**
 * Los socios ACTIVOS de un club, ordenados y con el logo YA FIRMADO.
 *
 * Es la composición de las dos de arriba, y la que usa la WEB: se renderiza en el
 * servidor en cada petición, así que la firma nace y se gasta en el mismo momento y
 * no hay nada que caduque guardado.
 *
 * LA APP NATIVA NO DEBE USAR ESTA: lo que lee acaba en la caché de disco, y ahí una
 * URL firmada se pudre en una hora. Allí van `getClubPartnerRowsFromClient` (a la
 * caché) y `signClubPartnerLogosFromClient` (fuera de ella, solo online).
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
  const filas = await getClubPartnerRowsFromClient(supabase, clubId, onError);
  if (filas.length === 0) return [];

  const firmadas = await signClubPartnerLogosFromClient(
    supabase,
    filas.map((r) => r.logoPath),
    onError,
    ttlSeconds,
  );

  return filas.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    tagline: r.tagline,
    logoUrl: firmadas.get(r.logoPath) ?? null,
    url: r.url,
  }));
}

/**
 * Reparte una lista en sus dos secciones, en el orden de `PARTNER_KINDS`.
 *
 * Existe para que las cinco superficies no escriban cinco veces el mismo `filter`.
 * Devuelve SIEMPRE las dos entradas, aunque estén vacías: así la pantalla decide si
 * pinta la sección mirando `length`, y no hay un `undefined` que recorrer.
 *
 * Genérica en la fila porque la nativa agrupa `ClubPartnerRow` (sin firmar, que es lo
 * que sale de la caché) y la web agrupa `ClubPartner` (ya firmado). Una sola función
 * para las dos: el reparto por `kind` es el mismo y no tiene por qué saber si hay
 * logo.
 */
export function groupPartnersByKind<T extends { kind: PartnerKind }>(
  partners: readonly T[],
): Record<PartnerKind, T[]> {
  const out = { patrocinador: [] as T[], colaborador: [] as T[] };
  for (const p of partners) out[p.kind].push(p);
  return out;
}
