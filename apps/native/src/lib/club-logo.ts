/**
 * URL pública del logo del club. IDÉNTICO criterio que apps/web (lib/club-logo.ts):
 * el bucket `club-logos` es PÚBLICO, así que la URL se construye a partir de la
 * URL de Supabase sin firmar ni llamar al cliente. En native la base viene de
 * `EXPO_PUBLIC_SUPABASE_URL`. Devuelve null si no hay logo.
 */
export function clubLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/club-logos/${path}`;
}

/**
 * F14J-5A — URL del ESCUDO de un club, para las pantallas PREVIAS al login.
 *
 * Convive con `clubLogoUrl` de arriba, que es la de CON sesión (la usa
 * `auth/context` para el club activo) y se queda intacta. Lo de aquí abajo añade
 * dos cosas que solo hacen falta antes de identificarse: pedir una variante
 * redimensionada, porque el escudo se descarga con la app recién instalada, y
 * unas iniciales de respaldo para no dejar un hueco en blanco.
 *
 * El bucket `club-logos` es PÚBLICO, así que la URL se construye a mano desde
 * `EXPO_PUBLIC_SUPABASE_URL` y no hace falta ni firma ni sesión. Es el espejo de
 * `apps/web/src/lib/club-logo.ts`, que hace lo mismo en la web.
 *
 * EL PESO, QUE AQUÍ SÍ IMPORTA
 * ----------------------------
 * El escudo tal cual se subió pesa lo que pese: el de UDFonteta son 913 KB para
 * una pantalla que se ve ANTES de identificarse, muchas veces con datos móviles
 * y a veces con la app recién instalada. Storage sirve además una variante
 * redimensionada bajo `/render/image/public/...`, y la diferencia no es sutil
 * (medido contra producción, ese mismo escudo):
 *
 *     original      913.639 bytes
 *     width=256      53.050
 *     width=192      30.840      ← el de la pantalla de acceso
 *     width=96        8.366      ← el de cada fila del selector
 *
 * Además responde con `cache-control: max-age=3600` y ETag, así que el caché
 * HTTP del sistema se encarga de las siguientes aperturas.
 *
 * `logoUrl` devuelve las DOS: la transformada para pedirla primero y la original
 * como red de seguridad. El redimensionado es una capacidad del plan de Storage,
 * no una garantía del esquema: si algún día dejara de servirse, `ClubCrest` cae
 * a la original en vez de quedarse sin escudo. Ninguna de las dos requiere
 * sesión.
 */

/** Anchura en px que pide cada superficie. Es el ancho SERVIDO, no el pintado. */
export const CREST_WIDTH = {
  /** Fila del selector de clubes. */
  row: 96,
  /** Escudo grande de la pantalla de acceso al club. */
  hero: 192,
} as const;

export type ClubCrestUrls = {
  /** Redimensionada en el servidor. Se intenta primero. */
  primary: string;
  /** El objeto tal cual se subió. Solo si la de arriba falla. */
  fallback: string;
};

/**
 * URLs del escudo, o `null` si el club no tiene (o si falta la variable de
 * entorno, que en un build sin configurar dejaría una URL rota).
 */
export function clubCrestUrls(
  path: string | null | undefined,
  width: number
): ClubCrestUrls | null {
  // Se lee en CADA llamada, no al cargar el modulo, igual que `clubLogoUrl` de
  // arriba: asi el valor es observable desde los tests en vez de quedar clavado
  // en el import. Metro la inlinea igual en el build.
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return {
    primary:
      `${base}/storage/v1/render/image/public/club-logos/${encoded}` +
      `?width=${width}&height=${width}&resize=contain`,
    fallback: `${base}/storage/v1/object/public/club-logos/${encoded}`,
  };
}

/**
 * Iniciales del club para cuando no hay escudo, no hay red o la imagen falla.
 * Una o dos letras: más deja de leerse a tamaño de fila.
 */
export function clubInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
