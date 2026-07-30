import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * O2-1 — Cliente Supabase AGNÓSTICO de framework.
 *
 * A diferencia de `createSupabaseBrowserClient` / `createSupabaseServerClient`
 * (que usan `@supabase/ssr` + cookies + `process.env.NEXT_PUBLIC_*`, acoplados a
 * Next), este monta el cliente con `@supabase/supabase-js` puro y recibe TODO por
 * parámetro: `url`, `anonKey` y el `storage` de la sesión. Así apps/native le
 * inyecta su `expo-secure-store` y sus `EXPO_PUBLIC_*` sin arrastrar nada de web.
 *
 * Mismo motor que `createSupabaseAdminClient` (también `@supabase/supabase-js`),
 * pero con la sesión PERSISTIDA en el `storage` inyectado y auto-refresh activo.
 */
export type CreateSupabaseClientOptions = {
  url: string;
  anonKey: string;
  /** Almacén de la sesión (contrato `SupportedStorage` de supabase-js). */
  storage: SupportedStorage;
};

export function createSupabaseClient({
  url,
  anonKey,
  storage,
}: CreateSupabaseClientOptions) {
  return createClient<Database>(url, anonKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      // No hay callback por URL en móvil: la sesión vive en el storage.
      detectSessionInUrl: false,
    },
  });
}
