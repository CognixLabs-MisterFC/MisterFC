import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  createSupabaseBearerClient,
  createSupabaseServerClient,
  extractBearerToken,
  type Database,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext, type ShellContext } from '@/lib/auth-shell';

/**
 * O2-5 F1 — Resolución de identidad para route handlers, aceptando DOS vías:
 *   - `Authorization: Bearer <access_token>` (app nativa, sin cookie).
 *   - cookie de sesión (web, como hoy).
 *
 * SEGURIDAD: en ambos casos devuelve un cliente RLS-scoped al usuario (bearer →
 * cliente con el JWT en el header; cookie → cliente de sesión). NUNCA un admin
 * client. El service-role se obtiene aparte y SOLO se usa para el efecto, tras el
 * gate del usuario. Un token inválido/caducado → getUser=null → devuelve null
 * (el handler responde 401).
 *
 * El comportamiento COOKIE es idéntico al de hoy (`loadShellContext` +
 * `createSupabaseServerClient`): `shell` viene poblado. En bearer, `shell` es null
 * (la app nativa no tiene "club activo" por cookie; el handler deriva lo que
 * necesite del recurso, p.ej. el club del jugador).
 */
export type ResolvedRequestAuth = {
  user: User;
  /** Cliente RLS-scoped al usuario (bearer o cookie). Nunca admin. */
  supabase: SupabaseClient<Database>;
  /** Contexto del shell (solo camino cookie); null en bearer. */
  shell: ShellContext | null;
};

export async function resolveUserFromRequest(
  request: Request,
): Promise<ResolvedRequestAuth | null> {
  const token = extractBearerToken(request.headers.get('authorization'));

  if (token) {
    const supabase = createSupabaseBearerClient(token);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;
    return { user, supabase, shell: null };
  }

  // Camino cookie — idéntico al de hoy.
  const shell = await loadShellContext();
  if (!shell) return null;
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  return { user: shell.user, supabase, shell };
}
