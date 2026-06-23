/**
 * F13.9a — Panel de "Novedades" en Inicio (server component).
 *
 * Bandeja read-only del feed in_app del usuario (D1): lee las últimas novedades
 * con `loadNotificationFeed`, las traduce con el mapper reusable y las pinta como
 * lista cronológica plana. Marca visual de NO LEÍDO (status `pending`) y cada
 * ítem navega por su destino derivado (mapper). Para TODOS los roles; la RLS ya
 * filtra por usuario. Se oculta si no hay novedades (patrón de los otros paneles).
 *
 * NO marca nada como leído (D2): abrir Inicio no debe mover pending→sent. El
 * marcar-leído por ítem y la página /novedades llegan en 13.9b.
 */

import { getTranslations } from 'next-intl/server';
import { Bell } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadNotificationFeed } from './notifications-feed-queries';
import { mapNotification } from './notifications-feed';

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

export async function NotificationsPanel({ locale }: { locale: string }) {
  const t = await getTranslations('home.feed');
  const rows = await loadNotificationFeed();
  if (rows.length === 0) return null;

  const items = rows.map((r) => mapNotification(r, t));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
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
                  <Link href={it.href} className="-mx-2 block rounded px-2 hover:bg-muted/50">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
