/**
 * Lectura de variables de entorno de Supabase.
 * Centralizada para que cualquier cambio (renaming, validación) viva en un solo sitio.
 */

export type SupabasePublicEnv = {
  url: string;
  anonKey: string;
};

export function readPublicEnv(env: NodeJS.ProcessEnv = process.env): SupabasePublicEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return { url, anonKey };
}
