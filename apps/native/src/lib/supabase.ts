import { createClient } from '@supabase/supabase-js';
// Reutiliza el tipo `Database` generado en @misterfc/core (contrato con el
// backend). NO se duplica: es el mismo tipo que usa apps/web.
import type { Database } from '@misterfc/core';
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
 * No se reutiliza `createSupabaseBrowserClient` de core: ese usa `@supabase/ssr`
 * (cookies del browser) y lee `process.env.NEXT_PUBLIC_*` de forma literal —
 * acoplado a Next/web y sin punto de inyección para el storage. Aquí montamos el
 * cliente con `@supabase/supabase-js` y el adaptador expo-secure-store que exige
 * el ADR-0020. La lógica de dominio (schemas, cálculos) sigue viniendo de core.
 *
 * NOTA (deuda para O2-1): cuando se cableen los flujos de auth reales habrá que
 * añadir el polyfill de URL para RN y valorar mover un helper
 * `createSupabaseClient(storage)` a core para no acoplar el convenio de env.
 */
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
