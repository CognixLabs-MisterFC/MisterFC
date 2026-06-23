'use client';

/**
 * F13.9b — enlace de una novedad que marca la notificación como leída al navegar.
 *
 * En clic normal: marca pending→sent por id (await) y luego navega, de modo que
 * el destino (y su layout) ya re-renderiza con la fila leída → los badges del
 * sidebar quedan sincronizados sin desfase. En clic con modificador (cmd/ctrl/
 * shift/medio) deja el comportamiento nativo (abrir en pestaña nueva) y solo
 * dispara el marcado en segundo plano.
 *
 * Recibe los hijos YA renderizados desde el server (icono + texto del mapper):
 * ningún componente/función cruza el límite server→client.
 */

import { useTransition, type ReactNode, type MouseEvent } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { markNotificationRead } from '@/lib/notifications-actions';

export function NotificationItemLink({
  id,
  href,
  unread,
  className,
  children,
}: {
  id: string;
  href: string;
  unread: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Clic con modificador o botón no primario → comportamiento nativo.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      if (unread) void markNotificationRead(id);
      return;
    }
    e.preventDefault();
    startTransition(async () => {
      if (unread) await markNotificationRead(id);
      router.push(href);
    });
  };

  return (
    <Link href={href} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}
