import { clubLogoUrl } from '@/lib/club-logo';
import { cn } from '@/lib/utils';

/**
 * F14B-9a — Logo del club. Si hay logo_path, pinta la imagen pública; si no,
 * un placeholder con la inicial del club (nunca un hueco roto). Componente puro
 * (sin hooks) → válido en RSC y en componentes cliente.
 */
export function ClubLogo({
  path,
  name,
  className,
}: {
  path: string | null | undefined;
  name: string;
  className?: string;
}) {
  const url = clubLogoUrl(path);
  const base = 'shrink-0 rounded object-cover';

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={cn(base, className)} />;
  }

  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground',
        className,
      )}
    >
      {initial}
    </span>
  );
}
