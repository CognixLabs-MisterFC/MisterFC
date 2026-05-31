import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Mejora I — avatar de jugador para los chips del editor y otras listas.
 * Foto (players.photo_url) con fallback a iniciales. Tamaño configurable.
 */

function initialsOf(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s.length > 0 ? s : '·';
}

export function PlayerAvatar({
  firstName,
  lastName,
  photoUrl,
  size = 'sm',
  className,
}: {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  return (
    <Avatar size={size} className={cn('shrink-0', className)}>
      {photoUrl && <AvatarImage src={photoUrl} alt="" />}
      <AvatarFallback className="font-semibold">
        {initialsOf(firstName, lastName)}
      </AvatarFallback>
    </Avatar>
  );
}
