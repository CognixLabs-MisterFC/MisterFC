import { createCookieAdapter } from '@/lib/supabase-cookies';
import { createSupabaseServerClient } from '@misterfc/core';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hora

type Props = {
  /** Path en el bucket `profile-avatars`, ej. `<user_id>/<uuid>.webp`. */
  path: string | null | undefined;
  fallback: string;
  className?: string;
};

/**
 * Avatar server-rendered que firma la URL del bucket privado en cada render.
 * El path se guarda en `profiles.avatar_url`; la URL firmada no se persiste.
 */
export async function ProfileAvatar({ path, fallback, className }: Props) {
  let signedUrl: string | null = null;

  if (path) {
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);
    const { data } = await supabase.storage
      .from('profile-avatars')
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    signedUrl = data?.signedUrl ?? null;
  }

  return (
    <Avatar className={className}>
      {signedUrl && <AvatarImage src={signedUrl} alt="" />}
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  );
}

/** Iniciales para fallback (máx 2 chars). */
export function initialsOf(name: string | null | undefined, fallback: string): string {
  const raw = (name ?? '').trim();
  if (!raw) return fallback.slice(0, 2).toUpperCase();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
