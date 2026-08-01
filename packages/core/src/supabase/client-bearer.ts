import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { readPublicEnv } from './env';

/**
 * O2-5 F1 — Cliente Supabase autenticado por ACCESS_TOKEN (JWT del usuario), para
 * que un route handler de Next acepte `Authorization: Bearer <token>` desde la app
 * nativa (que no tiene cookie). Es la fundación de la tanda de endpoints (F2/F3).
 *
 * SEGURIDAD (clave): usa la ANON KEY (nunca la service-role) + el JWT del usuario
 * en el header `Authorization`. PostgREST lee ese JWT → `auth.uid()` correcto →
 * las queries/RPC corren bajo la RLS del DUEÑO del token, igual que la cookie. NO
 * es un admin client; NO bypasea RLS. El bearer autentica QUIÉN es; el gate
 * (RLS/RPC) autoriza QUÉ. El service-role se obtiene aparte y SOLO se usa para el
 * efecto (email/push), DESPUÉS de que el gate del usuario haya pasado.
 */

/**
 * Extrae el token de una cabecera `Authorization`. Devuelve null si falta o no es
 * un `Bearer <token>` bien formado. Puro (testeable sin red).
 */
export function extractBearerToken(
  authorizationHeader: string | null | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return null;
  const token = (match[1] ?? '').trim();
  return token.length > 0 ? token : null;
}

/**
 * Opciones de `createClient` para un cliente RLS-scoped por token. El JWT va en el
 * header global `Authorization`; sin persistencia de sesión (stateless por
 * request). Puro (testeable) — permite verificar que NO hay service-role y que el
 * header se arma bien.
 */
export function bearerAuthOptions(accessToken: string) {
  return {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  } as const;
}

/**
 * Cliente Supabase RLS-scoped al usuario del `accessToken`. Valida el token con
 * `client.auth.getUser()` en el llamante (si el token es inválido/caducado,
 * getUser devuelve user=null → el endpoint responde 401).
 */
export function createSupabaseBearerClient(accessToken: string) {
  const { url, anonKey } = readPublicEnv();
  return createClient<Database>(url, anonKey, bearerAuthOptions(accessToken));
}
