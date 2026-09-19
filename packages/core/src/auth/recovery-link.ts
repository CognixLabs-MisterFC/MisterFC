/**
 * DESTINO DE LOS CORREOS DE RECUPERACIÓN DE CONTRASEÑA.
 *
 * BUG-4 — antes los tres remitentes (formulario web, modal de la app y perfil)
 * apuntaban a `/auth/callback?next=/{locale}/reset-password`, y ese rodeo perdía
 * la pantalla entera:
 *
 *   · La app monta Supabase con `createClient` de supabase-js, cuyo `flowType`
 *     por defecto es IMPLÍCITO. GoTrue entonces no devuelve un `code` que canjear:
 *     devuelve los tokens ya hechos en el FRAGMENTO de la URL
 *     (`#access_token=…&refresh_token=…`). Medido: en `auth.flow_state` no hay
 *     fila ninguna para esas peticiones, y tras el `/verify` no hay ni un `/token`.
 *   · El fragmento NO viaja al servidor. Y `/auth/callback` es un Route Handler:
 *     no veía ni `code` ni `token_hash`, así que se iba a signin TIRANDO el
 *     destino. El navegador arrastraba el fragmento hasta ahí, `AuthHashHandler`
 *     lo canjeaba, y el usuario entraba en la app sin que nadie le pidiera una
 *     contraseña nueva. La vieja seguía valiendo.
 *
 * Ahora el correo apunta DIRECTAMENTE a la pantalla, que es exactamente lo que
 * hacen las invitaciones — el único flujo que ya funcionaba —: el fragmento
 * aterriza donde vive `AuthHashHandler` y se canjea en cliente. Y cuando el
 * remitente sí usa PKCE (la web, vía `@supabase/ssr`), llega `?code=` y el
 * middleware lo reencamina al callback con el `next` puesto. Las dos vías
 * terminan en el formulario.
 *
 * OJO: no se puede "arreglar" pasando la app a PKCE. El `code_verifier` viviría
 * en el SecureStore del móvil y el enlace se abre en el NAVEGADOR del móvil, que
 * no lo tiene: el canje no podría ocurrir nunca.
 */
export function recoveryRedirectTo(baseUrl: string, locale: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/${locale}/reset-password`;
}
