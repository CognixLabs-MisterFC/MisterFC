/**
 * Lectura de variables de entorno de Supabase.
 * Centralizada para que cualquier cambio (renaming, validación) viva en un solo sitio.
 *
 * ⚠️  Acceso LITERAL a `process.env.NEXT_PUBLIC_*` por diseño.
 *
 * Next.js sólo sustituye estáticamente las vars `NEXT_PUBLIC_*` en el bundle
 * cliente cuando aparece la forma literal `process.env.NEXT_PUBLIC_FOO` en el
 * código que ve el bundler. Cualquier indirección (objeto intermedio, bracket
 * notation desde una variable, destructuring desde process.env) hace que el
 * static replacement no se aplique y, en el browser, la lectura devuelva
 * `undefined` — porque `process.env` en el cliente es un `{}` vacío salvo por
 * las claves que Next ya inlineó.
 *
 * El patrón previo `(env: NodeJS.ProcessEnv = process.env) => env.NEXT_PUBLIC_X`
 * funcionaba en SSR (Node real) pero rompía en cualquier Client Component que
 * invocara `createSupabaseBrowserClient()`. Por eso aquí se accede directo.
 */

export type SupabasePublicEnv = {
  url: string;
  anonKey: string;
};

export function readPublicEnv(): SupabasePublicEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return { url, anonKey };
}
