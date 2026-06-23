/**
 * F13.9a/b — Panel de "Novedades" en Inicio (server component).
 *
 * Bandeja read-only del feed in_app del usuario (D1): lee las últimas novedades
 * con `loadNotificationFeed`, las traduce con el mapper reusable y las pinta como
 * lista cronológica plana (NotificationFeedList). Marca visual de NO LEÍDO
 * (status `pending`). Para TODOS los roles; la RLS ya filtra por usuario. Se
 * oculta si no hay novedades (patrón de los otros paneles).
 *
 * F13.9b — cada ítem marca leído al navegar (NotificationItemLink); footer con
 * "marcar todas como leídas" (si hay pendientes) y "Ver todas" → /novedades.
 * Abrir Inicio NO marca nada (D2): solo navegar/pulsar mueve pending→sent.
 */

import { getTranslations } from 'next-intl/server';
import { Bell } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MarkAllReadButton } from '@/components/notifications/mark-all-read-button';
import {
  loadNotificationFeed,
  countUnreadNotifications,
} from './notifications-feed-queries';
import { mapNotification } from './notifications-feed';
import { NotificationFeedList } from './notification-feed-list';

export async function NotificationsPanel({ locale }: { locale: string }) {
  const t = await getTranslations('home.feed');
  const [rows, unread] = await Promise.all([
    loadNotificationFeed(),
    countUnreadNotifications(),
  ]);
  if (rows.length === 0) return null;

  const items = rows.map((r) => mapNotification(r, t));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        {unread > 0 ? (
          <MarkAllReadButton label={t('mark_all')} pendingLabel={t('marking')} />
        ) : null}
      </CardHeader>
      <CardContent className="text-sm">
        <NotificationFeedList items={items} locale={locale} />
      </CardContent>
      <CardFooter>
        <Link href="/novedades" className="text-sm text-misterfc-green hover:underline">
          {t('view_all')}
        </Link>
      </CardFooter>
    </Card>
  );
}
