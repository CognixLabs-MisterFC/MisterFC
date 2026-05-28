import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Cliente Supabase con service role (bypass RLS).
 *
 * ⚠️ Solo server-side. Nunca importar desde un componente cliente o cualquier
 * archivo que termine en el bundle del browser.
 *
 * Usos legítimos:
 *  - `supabase.auth.admin.inviteUserByEmail(...)` — envía email de invitación
 *    (template "Invite user" del dashboard) tras crear la fila en `invitations`.
 *  - `supabase.auth.admin.createUser(...)` — crear cuenta con email ya verificado
 *    en flujos donde la verificación viene por otro canal.
 *  - Operaciones de mantenimiento que no encajan en una server action con sesión.
 *
 * Lee `SUPABASE_SERVICE_ROLE_KEY` de `process.env`. Si falta, lanza para fallar
 * fuerte en el server-side; no hay fallback silencioso porque cualquier uso del
 * admin client implica intención explícita de bypassar RLS.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
