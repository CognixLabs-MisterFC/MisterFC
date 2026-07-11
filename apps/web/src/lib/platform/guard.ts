import { redirect } from 'next/navigation';
import { createSupabaseServerClient, getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

/**
 * F14B-7 — Guard de la consola de plataforma (rama `/platform`, hermana de
 * `(authenticated)` bajo `[locale]`, NO anidada en ella). El superadmin no tiene
 * club activo, así que este guard NO usa `loadShellContext`:
 *   - sin sesión → /{locale}/signin
 *   - con sesión pero NO superadmin → /{locale} (su app normal)
 *
 * `is_superadmin()` (F14B-1) es la única fuente de verdad. Devuelve el cliente
 * supabase ya creado para que la página lo reutilice en sus RPC de plataforma.
 */
export async function requireSuperadmin(
  locale: string,
): Promise<{ supabase: SupabaseServerClient }> {
  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) redirect(`/${locale}/signin`);

  const supabase = createSupabaseServerClient(adapter);
  const { data: isSuper } = await supabase.rpc('is_superadmin');
  if (isSuper !== true) redirect(`/${locale}`);

  return { supabase };
}
