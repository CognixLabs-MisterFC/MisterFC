import { avatarInitials } from '@misterfc/core';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Mejora I — avatar de jugador para los chips del editor y otras listas.
 * Foto firmada (`players.photo_url` del bucket privado, ya firmada en el server)
 * con fallback a iniciales. Tamaño configurable.
 */
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
        {avatarInitials(firstName, lastName)}
      </AvatarFallback>
    </Avatar>
  );
}
