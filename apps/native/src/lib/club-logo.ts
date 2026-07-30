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
