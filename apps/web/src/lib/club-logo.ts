/**
 * F14B-9a — URL pública del logo del club. El bucket `club-logos` es PÚBLICO, así
 * que la URL se construye a partir de NEXT_PUBLIC_SUPABASE_URL sin firmar ni
 * llamar al cliente (funciona en RSC y en cliente, y el login-por-club futuro la
 * usará sin sesión). Devuelve null si no hay logo.
 */
export function clubLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/club-logos/${path}`;
}
