import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from './types.js';
import { readPublicEnv } from './env.js';

/**
 * Cookie store contract — abstrae sobre next/headers para mantener
 * packages/core agnóstico de framework. apps/web le pasa su propio
 * adapter; apps/native (Ola 2) podrá pasar el suyo si llega a necesitar SSR.
 */
export type CookieAdapter = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookies: Array<{ name: string; value: string; options?: CookieOptions }>) => void;
};

/**
 * Cliente Supabase para Server Components, Route Handlers y middleware.
 * El caller proporciona el cookie adapter.
 */
export function createSupabaseServerClient(cookieAdapter: CookieAdapter) {
  const { url, anonKey } = readPublicEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: cookieAdapter.getAll,
      setAll: cookieAdapter.setAll,
    },
  });
}
