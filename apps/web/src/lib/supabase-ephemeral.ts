import { createSupabaseClient } from '@misterfc/core';

/**
 * Cliente Supabase de UNA petición, con la sesión en memoria.
 *
 * Para route handlers SIN sesión que necesitan iniciar una: la web guarda la sesión en
 * cookies y la nativa en SecureStore, pero aquí no queremos ninguna de las dos. El
 * handler inicia sesión, saca los tokens y se los devuelve al llamante; la sesión no
 * debe sobrevivir a la petición ni escribirse en ninguna cookie del servidor.
 *
 * El almacén es un objeto nuevo por llamada: dos peticiones concurrentes no se pisan.
 */
export function createEphemeralSupabaseClient() {
  const memoria = new Map<string, string>();

  return createSupabaseClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    storage: {
      getItem: (key: string) => memoria.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memoria.set(key, value);
      },
      removeItem: (key: string) => {
        memoria.delete(key);
      },
    },
  });
}
