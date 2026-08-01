export { createSupabaseBrowserClient } from './client-browser';
export {
  createSupabaseClient,
  type CreateSupabaseClientOptions,
} from './client';
export { createSupabaseServerClient, type CookieAdapter } from './client-server';
export { createSupabaseAdminClient } from './client-admin';
export {
  extractBearerToken,
  bearerAuthOptions,
  createSupabaseBearerClient,
} from './client-bearer';
export type { Database, Json } from './types';
