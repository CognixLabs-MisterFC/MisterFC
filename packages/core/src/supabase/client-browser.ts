import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';
import { readPublicEnv } from './env';

/**
 * Cliente Supabase para componentes de cliente (browser).
 * Cookies gestionadas automáticamente por @supabase/ssr.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = readPublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
