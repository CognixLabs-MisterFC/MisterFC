import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  CLUB_PARTNER_LOGOS_BUCKET,
  CLUB_PARTNER_LOGO_TTL_SECONDS,
  PARTNER_KINDS,
  signClubPartnerLogosFromClient,
  type ClubPartner,
  type PartnerKind,
} from './club-partners';

type DbClient = SupabaseClient<Database>;

/**
 * V-4 — LA GESTIÓN de patrocinadores y colaboradores. Solo la web la usa; en la app
 * son de lectura.
 *
 * Por qué las reglas viven aquí y no en la página: `apps/web` no ejecuta ni una
 * prueba. Todo lo que puede estar mal —un nombre de 300 caracteres, un `javascript:`
 * en el enlace, una ruta de logo que la policy de Storage rechaza, un «subir» que no
 * mueve nada— se decide en funciones de este fichero, que sí tienen tests. La página
 * queda como una capa fina que pinta y llama.
 *
 * LOS LÍMITES SON LOS DEL ESQUEMA, a propósito duplicados. La tabla ya los defiende
 * con CHECKs (mig 20261112000000) y seguirá haciéndolo; esto existe para que quien
 * gestiona lea «el nombre es demasiado largo» en su idioma en vez de recibir un 23514.
 * Si un día cambia el CHECK, cambia aquí: el test los nombra uno a uno.
 */

/** `char_length(btrim(name)) between 1 and 120`. */
export const CLUB_PARTNER_NAME_MAX = 120;
/** `tagline is null or char_length(btrim(tagline)) between 1 and 160`. */
export const CLUB_PARTNER_TAGLINE_MAX = 160;
/** `char_length(url) between 8 and 500` — 8 es lo que mide `http://a`. */
export const CLUB_PARTNER_URL_MIN = 8;
export const CLUB_PARTNER_URL_MAX = 500;
/** `char_length(logo_path) between 1 and 200`. */
export const CLUB_PARTNER_LOGO_PATH_MAX = 200;

/**
 * Los tipos de imagen aceptados y su extensión, la misma tabla que usa el escudo del
 * club. El `ext` no es cosmético: va dentro del path del objeto y es lo único que le
 * dice a un navegador qué está descargando.
 */
export const CLUB_PARTNER_LOGO_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type ClubPartnerInput = {
  kind: PartnerKind;
  name: string;
  tagline: string | null;
  url: string;
};

export type ClubPartnerInputError = 'kind' | 'name' | 'tagline' | 'url';

export type ClubPartnerInputResult =
  | { ok: true; value: ClubPartnerInput }
  | { ok: false; error: ClubPartnerInputError };

/**
 * Valida y NORMALIZA lo que se va a guardar.
 *
 * Normaliza además de validar: recorta los espacios y convierte una línea vacía en
 * `null`. El CHECK de `tagline` rechaza la cadena vacía, así que mandar `''` desde un
 * formulario en el que nadie escribió nada sería un 23514 por no haber recortado.
 *
 * EL ENLACE ES LO SERIO DE AQUÍ. La app lo abre con `Linking.openURL` y la web lo
 * pinta como `href`: sin exigir `http(s)://` explícito cabría un `javascript:` o un
 * `data:`. Se comprueba igual que el CHECK, y no con una lista de esquemas prohibidos
 * —una lista negra se queda corta—, sino exigiendo el único par que se admite.
 */
export function validateClubPartnerInput(input: {
  kind: string;
  name: string;
  tagline?: string | null;
  url: string;
}): ClubPartnerInputResult {
  if (!(PARTNER_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: 'kind' };
  }

  const name = input.name.trim();
  if (name.length < 1 || name.length > CLUB_PARTNER_NAME_MAX) {
    return { ok: false, error: 'name' };
  }

  const taglineBruto = (input.tagline ?? '').trim();
  const tagline = taglineBruto.length === 0 ? null : taglineBruto;
  if (tagline !== null && tagline.length > CLUB_PARTNER_TAGLINE_MAX) {
    return { ok: false, error: 'tagline' };
  }

  const url = input.url.trim();
  if (
    url.length < CLUB_PARTNER_URL_MIN ||
    url.length > CLUB_PARTNER_URL_MAX ||
    !/^https?:\/\//i.test(url)
  ) {
    return { ok: false, error: 'url' };
  }

  return { ok: true, value: { kind: input.kind as PartnerKind, name, tagline, url } };
}

/**
 * La ruta del objeto dentro del bucket: `{club_id}/{uuid}.{ext}`.
 *
 * LA PRIMERA CARPETA TIENE QUE SER EL club_id Y NO ES UNA CONVENCIÓN: la policy de
 * Storage de V-1 comprueba `user_is_admin_or_director(((storage.foldername(name))[1])::uuid)`.
 * Una ruta con otra forma no da un error de validación, da un 42501 al subir, que es
 * mucho menos evidente. Por eso la construye esta función y no una plantilla suelta en
 * la página.
 *
 * El `uuid` entra por parámetro para que el test pueda fijarlo.
 */
export function clubPartnerLogoObjectPath(
  clubId: string,
  mime: string,
  uuid: string = crypto.randomUUID(),
): { ok: true; path: string } | { ok: false; error: 'mime' } {
  const ext = CLUB_PARTNER_LOGO_EXT_BY_MIME[mime];
  if (!ext) return { ok: false, error: 'mime' };
  return { ok: true, path: `${clubId}/${uuid}.${ext}` };
}

/** Un socio como lo ve quien gestiona: con su estado y su posición. */
export type ManagedClubPartner = ClubPartner & {
  active: boolean;
  sortOrder: number;
  /** La ruta cruda, que hace falta para borrar el objeto al borrar la fila. */
  logoPath: string;
};

/**
 * TODOS los socios del club, activos y retirados, con el logo firmado.
 *
 * Es la función que V-2 dejó pendiente, y es OTRA que la de los inicios en vez de una
 * bandera `incluirRetirados`: una bandera acaba pasándose desde una pantalla de inicio
 * y entonces el club ve a un patrocinador que se fue. Aquí no hay filtro de `active`
 * porque ESTA sí los quiere todos, y la RLS ya se encarga de que solo los reciba quien
 * gestiona (su policy de escritura es permisiva y se suma al SELECT).
 */
export async function getClubPartnersForManageFromClient(
  supabase: DbClient,
  clubId: string,
  onError?: (err: unknown, paso: string) => void,
  ttlSeconds: number = CLUB_PARTNER_LOGO_TTL_SECONDS,
): Promise<ManagedClubPartner[]> {
  const { data: rows, error } = await supabase
    .from('club_partners')
    .select('id, kind, name, tagline, logo_path, url, sort_order, active')
    .eq('club_id', clubId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    onError?.(error, 'select');
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const validas = rows.filter((r) => (PARTNER_KINDS as readonly string[]).includes(r.kind));
  const firmadas = await signClubPartnerLogosFromClient(
    supabase,
    validas.map((r) => r.logo_path),
    onError,
    ttlSeconds,
  );

  return validas.map((r) => ({
    id: r.id,
    kind: r.kind as PartnerKind,
    name: r.name,
    tagline: r.tagline,
    logoUrl: firmadas.get(r.logo_path) ?? null,
    logoPath: r.logo_path,
    url: r.url,
    active: r.active,
    sortOrder: r.sort_order,
  }));
}

export type WriteResult<E extends string = 'generic'> =
  | { success: true }
  | { success: false; error: E | 'generic' };

/**
 * La posición que le toca a un socio nuevo: detrás del último de SU tipo.
 *
 * Por tipo y no global porque las dos secciones se pintan por separado; un
 * colaborador nuevo tiene que quedar al final de los colaboradores, no al final de
 * todo.
 */
export function nextClubPartnerSortOrder(
  existentes: readonly { kind: PartnerKind; sortOrder: number }[],
  kind: PartnerKind,
): number {
  const suyos = existentes.filter((p) => p.kind === kind);
  if (suyos.length === 0) return 0;
  return Math.max(...suyos.map((p) => p.sortOrder)) + 1;
}

/**
 * Qué hay que escribir para mover un socio una posición arriba o abajo.
 *
 * FUNCIÓN PURA, y es donde vive la parte que se hace mal sola. Dos cosas:
 *
 *  1. SE MUEVE DENTRO DE SU TIPO. `sort_order` es una sola columna para las dos
 *     secciones, pero la pantalla las pinta separadas. Intercambiar con «el de
 *     arriba» a secas puede tocar a uno del otro tipo, y entonces el usuario pulsa
 *     la flecha y NO PASA NADA visible: los dos siguen en el mismo sitio de su
 *     sección. El vecino se busca entre los del mismo `kind`.
 *
 *  2. SE REASIGNAN POSICIONES, no se intercambian valores. Todas las filas nacen con
 *     `sort_order = 0` por defecto, así que intercambiar dos ceros tampoco mueve
 *     nada; el orden lo desempata `created_at`. Devolver posiciones 0..n-1 del tipo
 *     arregla los empates de paso, y solo para las filas cuyo valor cambia.
 *
 * Devuelve `null` si no hay a dónde moverlo (el primero hacia arriba, el último hacia
 * abajo) o si el id no está en la lista: la pantalla desactiva la flecha y nadie
 * escribe.
 */
export function planClubPartnerMove(
  lista: readonly { id: string; kind: PartnerKind; sortOrder: number }[],
  partnerId: string,
  direccion: 'up' | 'down',
): { id: string; sortOrder: number }[] | null {
  const yo = lista.find((p) => p.id === partnerId);
  if (!yo) return null;

  // El mismo orden con el que se leen y se pintan.
  const hermanos = lista
    .filter((p) => p.kind === yo.kind)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const i = hermanos.findIndex((p) => p.id === partnerId);
  const j = direccion === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= hermanos.length) return null;

  const movidos = hermanos.slice();
  const a = movidos[i]!;
  const b = movidos[j]!;
  movidos[i] = b;
  movidos[j] = a;

  const escrituras: { id: string; sortOrder: number }[] = [];
  movidos.forEach((p, pos) => {
    if (p.sortOrder !== pos) escrituras.push({ id: p.id, sortOrder: pos });
  });
  return escrituras;
}

/** Alta. El logo ya está subido: `logo_path` es NOT NULL y la fila no existe sin él. */
export async function createClubPartnerFromClient(
  supabase: DbClient,
  clubId: string,
  input: ClubPartnerInput,
  logoPath: string,
  sortOrder: number,
): Promise<WriteResult<'logo_path' | 'forbidden'>> {
  if (logoPath.length < 1 || logoPath.length > CLUB_PARTNER_LOGO_PATH_MAX) {
    return { success: false, error: 'logo_path' };
  }
  if (/^https?:\/\//i.test(logoPath)) return { success: false, error: 'logo_path' };

  const { error } = await supabase.from('club_partners').insert({
    club_id: clubId,
    kind: input.kind,
    name: input.name,
    tagline: input.tagline,
    logo_path: logoPath,
    url: input.url,
    sort_order: sortOrder,
  });
  if (error) return { success: false, error: esDenegado(error) ? 'forbidden' : 'generic' };
  return { success: true };
}

/**
 * Edición de los datos. NO toca el logo ni la posición: cada cosa tiene su acción, así
 * que guardar el nombre no puede llevarse por delante el orden que alguien acaba de
 * ajustar.
 */
export async function updateClubPartnerFromClient(
  supabase: DbClient,
  partnerId: string,
  input: ClubPartnerInput,
): Promise<WriteResult<'forbidden'>> {
  const { error } = await supabase
    .from('club_partners')
    .update({
      kind: input.kind,
      name: input.name,
      tagline: input.tagline,
      url: input.url,
    })
    .eq('id', partnerId);
  if (error) return { success: false, error: esDenegado(error) ? 'forbidden' : 'generic' };
  return { success: true };
}

/** Cambia el logo por otro ya subido. Deja huérfano el anterior, a propósito (ver abajo). */
export async function setClubPartnerLogoFromClient(
  supabase: DbClient,
  partnerId: string,
  logoPath: string,
  logoPathAnterior: string | null,
): Promise<WriteResult<'logo_path' | 'forbidden'>> {
  if (logoPath.length < 1 || logoPath.length > CLUB_PARTNER_LOGO_PATH_MAX) {
    return { success: false, error: 'logo_path' };
  }
  const { error } = await supabase
    .from('club_partners')
    .update({ logo_path: logoPath })
    .eq('id', partnerId);
  if (error) return { success: false, error: esDenegado(error) ? 'forbidden' : 'generic' };
  await borrarObjeto(supabase, logoPathAnterior);
  return { success: true };
}

/** Retirar o devolver a los inicios. La fila se conserva. */
export async function setClubPartnerActiveFromClient(
  supabase: DbClient,
  partnerId: string,
  active: boolean,
): Promise<WriteResult<'forbidden'>> {
  const { error } = await supabase
    .from('club_partners')
    .update({ active })
    .eq('id', partnerId);
  if (error) return { success: false, error: esDenegado(error) ? 'forbidden' : 'generic' };
  return { success: true };
}

/** Aplica el plan de `planClubPartnerMove`. */
export async function applyClubPartnerOrderFromClient(
  supabase: DbClient,
  escrituras: readonly { id: string; sortOrder: number }[],
): Promise<WriteResult<'forbidden'>> {
  for (const e of escrituras) {
    const { error } = await supabase
      .from('club_partners')
      .update({ sort_order: e.sortOrder })
      .eq('id', e.id);
    // Se corta en el primer fallo. Un plan a medio aplicar deja dos socios con la
    // misma posición, que el orden de lectura desempata por `created_at`: la lista
    // queda determinista, solo no en el orden que se pidió. Seguir escribiendo tras
    // un 42501 no arreglaría nada.
    if (error) return { success: false, error: esDenegado(error) ? 'forbidden' : 'generic' };
  }
  return { success: true };
}

/**
 * Borrado de verdad: se va la fila y, después, su logo.
 *
 * EL ORDEN IMPORTA Y EL BORRADO DEL OBJETO ES BEST-EFFORT, el mismo criterio que
 * `removeAvatarObject` en `profile/writes.ts`: primero la fila, porque es lo que el
 * usuario pidió; luego el objeto, y si eso falla no se deshace nada. Lo peor que
 * queda es un logo huérfano en el bucket — el logo de una empresa, no un dato
 * personal —, y V-1 ya lo daba por asumido en el comentario de `logo_path`.
 *
 * Al contrario, borrar el objeto primero dejaría una fila viva apuntando a un logo
 * que ya no existe: cuatro pantallas pintando el hueco de un socio.
 *
 * No hace falta service-role: la policy `club_partner_logos_delete_admin_or_director`
 * de V-1 deja borrar a quien gestiona el club de esa carpeta.
 */
export async function deleteClubPartnerFromClient(
  supabase: DbClient,
  partnerId: string,
  logoPath: string | null,
): Promise<WriteResult<'forbidden'>> {
  const { error } = await supabase.from('club_partners').delete().eq('id', partnerId);
  if (error) return { success: false, error: esDenegado(error) ? 'forbidden' : 'generic' };
  await borrarObjeto(supabase, logoPath);
  return { success: true };
}

async function borrarObjeto(supabase: DbClient, path: string | null): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(CLUB_PARTNER_LOGOS_BUCKET).remove([path]);
  } catch {
    // Huérfano en el bucket, nada más. La fila ya está como se pidió.
  }
}

/** 42501 = la RLS dijo no. Se distingue para poder decir «no tienes permiso». */
function esDenegado(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '42501'
  );
}
