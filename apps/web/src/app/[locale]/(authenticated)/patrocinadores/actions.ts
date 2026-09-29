'use server';

/**
 * V-4 — Server Actions de patrocinadores y colaboradores.
 *
 * Capa FINA. Todas las reglas (validar, construir la ruta del logo, planear un
 * movimiento, el orden de borrado) están en `@misterfc/core`, que sí tiene tests;
 * aquí solo se resuelve quién llama, se traduce el resultado y se revalida.
 *
 * ── DOS COSAS QUE NO SE LE PREGUNTAN AL CLIENTE ─────────────────────────────
 *
 * 1. EL CLUB. Sale de la cookie de club activo, en el servidor, como en `ajustes`.
 *    Si lo mandara el cliente, la RLS lo rechazaría igual —`user_is_admin_or_director`
 *    mira el club de la fila—, pero resolviéndolo aquí no hay ni intento.
 *
 * 2. LA RUTA DEL LOGO AL BORRAR. Se LEE de la fila, nunca llega por parámetro. Esto
 *    no es ceremonia: `deleteClubPartnerFromClient` le pasa esa ruta a
 *    `storage.remove()`, y la policy de Storage autoriza a borrar CUALQUIER objeto de
 *    la carpeta del club. Un cliente que mandara la ruta del logo de otro socio
 *    borraría ese logo al borrar el suyo. Leyéndola de la fila que se va a borrar, la
 *    ruta y la fila son la misma cosa por construcción.
 *
 * La autoridad sigue siendo la RLS: no se re-chequea el rol aquí. Un 42501 se traduce
 * a 'forbidden' y la pantalla lo dice.
 */

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  createSupabaseServerClient,
  getCurrentUserClubs,
  resolveActiveClub,
  validateClubPartnerInput,
  getClubPartnersForManageFromClient,
  nextClubPartnerSortOrder,
  planClubPartnerMove,
  createClubPartnerFromClient,
  updateClubPartnerFromClient,
  setClubPartnerLogoFromClient,
  setClubPartnerActiveFromClient,
  applyClubPartnerOrderFromClient,
  deleteClubPartnerFromClient,
  CLUB_PARTNER_LOGO_PATH_MAX,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type ActionResult = { success?: boolean; error?: string };

const RUTA = '/[locale]/(authenticated)/patrocinadores';

async function contexto() {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  const cookieStore = await cookies();
  const { active } = resolveActiveClub(clubs, cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null);
  const clubId = active?.club.id ?? null;
  if (!clubId) return null;
  return { clubId, supabase: createSupabaseServerClient(await createCookieAdapter()) };
}

/**
 * La ruta tiene que colgar de la carpeta de ESTE club. Si no, el objeto sería
 * ilegible (la policy de lectura mira la primera carpeta) y además se podría guardar
 * en la fila una ruta que apunta al bucket de otro club.
 */
function rutaDelClub(logoPath: string, clubId: string): boolean {
  return (
    logoPath.startsWith(`${clubId}/`) &&
    logoPath.length > clubId.length + 1 &&
    logoPath.length <= CLUB_PARTNER_LOGO_PATH_MAX &&
    !logoPath.includes('..')
  );
}

export async function createPartner(input: unknown, logoPath: unknown): Promise<ActionResult> {
  const ctx = await contexto();
  if (!ctx) return { error: 'no_active_club' };
  if (typeof logoPath !== 'string' || !rutaDelClub(logoPath, ctx.clubId)) {
    return { error: 'logo_path' };
  }

  const datos = input as { kind: string; name: string; tagline?: string | null; url: string };
  if (!datos || typeof datos !== 'object') return { error: 'invalid' };
  const v = validateClubPartnerInput(datos);
  if (!v.ok) return { error: v.error };

  // La posición se calcula con la lista de verdad, no con la que tenga abierta el
  // navegador: si alguien dio de alta otro socio en otra pestaña, el nuevo va detrás.
  const existentes = await getClubPartnersForManageFromClient(ctx.supabase, ctx.clubId);
  const sortOrder = nextClubPartnerSortOrder(existentes, v.value.kind);

  const r = await createClubPartnerFromClient(ctx.supabase, ctx.clubId, v.value, logoPath, sortOrder);
  if (!r.success) return { error: r.error };
  revalidatePath(RUTA, 'page');
  return { success: true };
}

export async function updatePartner(partnerId: unknown, input: unknown): Promise<ActionResult> {
  const ctx = await contexto();
  if (!ctx) return { error: 'no_active_club' };
  if (typeof partnerId !== 'string' || partnerId.length === 0) return { error: 'invalid' };

  const v = validateClubPartnerInput(input as { kind: string; name: string; tagline?: string | null; url: string });
  if (!v.ok) return { error: v.error };

  const r = await updateClubPartnerFromClient(ctx.supabase, partnerId, v.value);
  if (!r.success) return { error: r.error };
  revalidatePath(RUTA, 'page');
  return { success: true };
}

export async function replacePartnerLogo(partnerId: unknown, logoPath: unknown): Promise<ActionResult> {
  const ctx = await contexto();
  if (!ctx) return { error: 'no_active_club' };
  if (typeof partnerId !== 'string' || partnerId.length === 0) return { error: 'invalid' };
  if (typeof logoPath !== 'string' || !rutaDelClub(logoPath, ctx.clubId)) {
    return { error: 'logo_path' };
  }

  // La ruta ANTERIOR se lee, por lo dicho en la cabecera: es la que se va a borrar.
  const actual = await filaDelClub(ctx.supabase, ctx.clubId, partnerId);
  if (!actual) return { error: 'not_found' };

  const r = await setClubPartnerLogoFromClient(ctx.supabase, partnerId, logoPath, actual.logoPath);
  if (!r.success) return { error: r.error };
  revalidatePath(RUTA, 'page');
  return { success: true };
}

export async function setPartnerActive(partnerId: unknown, active: unknown): Promise<ActionResult> {
  const ctx = await contexto();
  if (!ctx) return { error: 'no_active_club' };
  if (typeof partnerId !== 'string' || partnerId.length === 0) return { error: 'invalid' };
  if (typeof active !== 'boolean') return { error: 'invalid' };

  const r = await setClubPartnerActiveFromClient(ctx.supabase, partnerId, active);
  if (!r.success) return { error: r.error };
  revalidatePath(RUTA, 'page');
  return { success: true };
}

export async function movePartner(partnerId: unknown, direccion: unknown): Promise<ActionResult> {
  const ctx = await contexto();
  if (!ctx) return { error: 'no_active_club' };
  if (typeof partnerId !== 'string' || partnerId.length === 0) return { error: 'invalid' };
  if (direccion !== 'up' && direccion !== 'down') return { error: 'invalid' };

  // El plan se hace sobre la lista LEÍDA AHORA. La del navegador puede estar vieja, y
  // reordenar sobre una lista vieja es la forma de dejar el orden peor que estaba.
  const lista = await getClubPartnersForManageFromClient(ctx.supabase, ctx.clubId);
  const plan = planClubPartnerMove(lista, partnerId, direccion);
  // `null` = no hay a dónde moverlo. No es un error: la flecha ya venía desactivada.
  if (!plan) return { success: true };

  const r = await applyClubPartnerOrderFromClient(ctx.supabase, plan);
  if (!r.success) return { error: r.error };
  revalidatePath(RUTA, 'page');
  return { success: true };
}

export async function deletePartner(partnerId: unknown): Promise<ActionResult> {
  const ctx = await contexto();
  if (!ctx) return { error: 'no_active_club' };
  if (typeof partnerId !== 'string' || partnerId.length === 0) return { error: 'invalid' };

  const fila = await filaDelClub(ctx.supabase, ctx.clubId, partnerId);
  if (!fila) return { error: 'not_found' };

  const r = await deleteClubPartnerFromClient(ctx.supabase, partnerId, fila.logoPath);
  if (!r.success) return { error: r.error };
  revalidatePath(RUTA, 'page');
  return { success: true };
}

/** La fila, buscada DENTRO del club activo. Devuelve su ruta de logo o null. */
async function filaDelClub(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  clubId: string,
  partnerId: string,
): Promise<{ logoPath: string } | null> {
  const { data, error } = await supabase
    .from('club_partners')
    .select('logo_path')
    .eq('id', partnerId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (error || !data) return null;
  return { logoPath: data.logo_path };
}
