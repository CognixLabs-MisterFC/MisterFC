/**
 * F13.9b — render compartido del feed de novedades (server component), usado por
 * el panel de Inicio y por la página /novedades. Pinta cada ítem ya mapeado
 * (icono + texto + fecha + punto de no-leído) y, si tiene destino, lo envuelve en
 * <NotificationItemLink> (cliente) que marca leído al navegar. El icono se
 * renderiza aquí (server) → ninguna función cruza el límite hacia el cliente.
 */

import { NotificationItemLink } from '@/components/notifications/notification-item-link';
import type { MappedNotification } from './notifications-feed';

/** Fecha relativa compacta ("hace 5 min", "ayer"…) con caída a fecha corta. */
function fmtRelative(iso: string, locale: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const min = Math.round(diffMs / 60000);
  if (Math.abs(min) < 60) return rtf.format(min, 'minute');
  const hours = Math.round(diffMs / 3600000);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(diffMs / 86400000);
  if (Math.abs(days) < 7) return rtf.format(days, 'day');
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function NotificationFeedList({
  items,
  locale,
}: {
  items: MappedNotification[];
  locale: string;
}) {
  return (
    <ul className="flex flex-col divide-y">
      {items.map((it) => {
        const row = (
          <div className="flex items-center gap-3 py-2">
            {/* Punto de no-leído (espacio reservado para alinear leídas). */}
            <span
              aria-hidden
              className={`size-2 shrink-0 rounded-full ${
                it.unread ? 'bg-misterfc-green' : 'bg-transparent'
              }`}
            />
            <it.Icon
              className={`size-4 shrink-0 ${it.unread ? 'text-foreground' : 'text-muted-foreground'}`}
            />
            <span className={`flex-1 ${it.unread ? 'font-medium' : 'text-muted-foreground'}`}>
              {it.text}
            </span>
            <time
              dateTime={it.createdAt}
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
            >
              {fmtRelative(it.createdAt, locale)}
            </time>
          </div>
        );
        return (
          <li key={it.id}>
            {it.href ? (
              <NotificationItemLink
                id={it.id}
                href={it.href}
                unread={it.unread}
                className="-mx-2 block rounded px-2 hover:bg-muted/50"
              >
                {row}
              </NotificationItemLink>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
