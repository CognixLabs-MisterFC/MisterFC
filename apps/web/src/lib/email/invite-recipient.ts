import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@misterfc/core';
import { routing } from '@/i18n/routing';

/**
 * Correo-B1 — ¿Quién hay detrás de esta dirección de correo, y en qué idioma se le
 * escribe?
 *
 * Dos preguntas, una sola búsqueda, porque las dos necesitan lo mismo: encontrar la
 * cuenta por correo. El sender la usa para decidir tres cosas distintas:
 *   · si hay que CREAR cuenta (no la hay),
 *   · si hay que ENLAZAR una que creamos y nadie reclamó (`invite_pending`) — sin
 *     esto, reenviar una invitación deja al invitado pidiéndole una contraseña que
 *     nunca fijó, que es la trampa del incidente de agosto de 2026,
 *   · y en qué IDIOMA escribirle: el suyo si tiene perfil, el de quien invita si no.
 *
 * Hacen falta dos saltos porque el correo vive en `auth.users` y el idioma en
 * `public.profiles`, que no guarda email: primero la cuenta por correo en la API de
 * administración de GoTrue, luego su perfil por id.
 */

type DbClient = SupabaseClient<Database>;

export type InviteRecipient = {
  userId: string;
  /** Cuenta creada por una invitación anterior y todavía sin reclamar. */
  invitePending: boolean;
  /** `profiles.locale`, o null si no tiene perfil. */
  locale: string | null;
};

/** Idiomas que existen de verdad (los de next-intl: es, en, va). */
export function normalizeLocale(valor: unknown, porDefecto: string): string {
  return typeof valor === 'string' && (routing.locales as readonly string[]).includes(valor)
    ? valor
    : porDefecto;
}

/**
 * Busca la cuenta por correo con la API de administración.
 *
 * `filter` hace búsqueda PARCIAL, así que se compara el email exacto (sin distinguir
 * mayúsculas) sobre los resultados: `filter=ana@club.es` también devolvería
 * `mariana@club.es`, y confundirse de cuenta aquí significaría enlazar la invitación
 * de uno a la cuenta de otro.
 */
async function findAccountByEmail(
  email: string,
): Promise<{ id: string; invitePending: boolean } | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;

  const url = `${base}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const body = (await res.json()) as {
    users?: {
      id?: string;
      email?: string;
      user_metadata?: { invite_pending?: boolean } | null;
    }[];
  };
  const buscado = email.trim().toLowerCase();
  const encontrado = (body.users ?? []).find(
    (u) => typeof u.email === 'string' && u.email.toLowerCase() === buscado,
  );
  if (!encontrado?.id) return null;

  // Mismo bucket que lee `isInvitePending` (core): user_metadata, NO app_metadata.
  // Leerlo del sitio equivocado devuelve siempre false y deja el caso sin cubrir —
  // fue el fallo que dejó inerte el cinturón anti-trampa en producción.
  return {
    id: encontrado.id,
    invitePending: encontrado.user_metadata?.invite_pending === true,
  };
}

/**
 * Destinatario de una invitación, o null si esa dirección no tiene cuenta.
 *
 * NUNCA lanza: un tropiezo (GoTrue caído, timeout) devuelve null, y el sender sigue
 * por el camino de "no tiene cuenta", que es el normal. Con la excepción de que
 * `createUser` dirá la verdad después si la cuenta sí existía.
 *
 * @param admin cliente service-role: lee `profiles` saltándose la RLS, porque quien
 *              invita no tiene por qué poder ver el perfil del invitado.
 */
export async function lookupInviteRecipient(
  admin: DbClient,
  email: string,
): Promise<InviteRecipient | null> {
  try {
    const cuenta = await findAccountByEmail(email);
    if (!cuenta) return null;

    const { data } = await admin
      .from('profiles')
      .select('locale')
      .eq('id', cuenta.id)
      .maybeSingle();

    return {
      userId: cuenta.id,
      invitePending: cuenta.invitePending,
      locale: typeof data?.locale === 'string' ? data.locale : null,
    };
  } catch {
    return null;
  }
}
