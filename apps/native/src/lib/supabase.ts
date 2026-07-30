import { createSupabaseClient } from '@misterfc/core';
import { SecureStoreAdapter } from './secure-store-adapter';

// Convenio de Expo: las públicas van como EXPO_PUBLIC_* (inlined por Metro).
// La anon key es pública por diseño; los secretos reales van como EAS secrets.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY',
  );
}

/**
 * Cliente Supabase de la app nativa.
 *
 * O2-1: monta el cliente con el helper AGNÓSTICO `createSupabaseClient` de core
 * (sobre `@supabase/supabase-js`, NO `@supabase/ssr`), inyectándole el adaptador
 * `expo-secure-store` (ADR-0020) y las `EXPO_PUBLIC_*`. Se elimina el `createClient`
 * que native montaba por su cuenta en O2-0: la construcción vive ahora en core, y
 * apps/web/apps/native comparten el mismo contrato de cliente. (Deuda de O2-0 saldada.)
 *
 * El polyfill de `URL` para React Native (que supabase-js necesita en runtime) se
 * importa en el entry de la app (`app/_layout.tsx`), antes de tocar el cliente.
 */
export const supabase = createSupabaseClient({
  url,
  anonKey,
  storage: SecureStoreAdapter,
});
