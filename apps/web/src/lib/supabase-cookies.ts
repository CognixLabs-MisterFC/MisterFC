import { cookies } from 'next/headers';
import type { CookieAdapter } from '@misterfc/core';

/**
 * Construye un `CookieAdapter` para usar `createSupabaseServerClient` desde
 * Server Components, Route Handlers y Server Actions de Next.js.
 *
 * `next/headers` devuelve el store de forma asíncrona en Next 16, pero las
 * operaciones `getAll`/`set` sobre el store ya obtenido son síncronas, así
 * que el adapter cumple el contrato del core.
 *
 * Nota: en Server Components, intentar `cookies().set()` lanza un error. Por
 * eso `setAll` se envuelve en try/catch silencioso — el refresh real de
 * cookies sucede en el middleware, donde sí se pueden mutar.
 */
export async function createCookieAdapter(): Promise<CookieAdapter> {
  const store = await cookies();
  return {
    getAll() {
      return store.getAll().map((c) => ({ name: c.name, value: c.value }));
    },
    setAll(cookiesToSet) {
      for (const { name, value, options } of cookiesToSet) {
        try {
          store.set(name, value, options);
        } catch {
          // Server Components no permiten mutar cookies. El middleware lo cubrirá.
        }
      }
    },
  };
}
