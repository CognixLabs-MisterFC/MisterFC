/**
 * F13.9b — Página /novedades: listado completo del feed in_app, paginado
 * server-side (.range() + count exacto, patrón F2.10). Reusa el mapper de 13.9a
 * (icono/texto/deep_link) y el render compartido (NotificationFeedList): cada
 * ítem navega y marca leído. Botón "marcar todas". Para todos los roles; la RLS
 * select-own filtra por usuario. No marca nada al abrir (D2).
 */

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Bell } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MarkAllReadButton } from '@/components/notifications/mark-all-read-button';
import {
  loadNotificationsPage,
  countUnreadNotifications,
  NOVEDADES_PAGE_SIZE,
} from '../notifications-feed-queries';
import { mapNotification } from '../notifications-feed';
import { NotificationFeedList } from '../notification-feed-list';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
};

function normalizePage(v: string | undefined): number {
  const n = v != null ? parseInt(v, 10) : 1;
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

export default async function NovedadesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('novedades');
  const tFeed = await getTranslations('home.feed');
  const page = normalizePage(sp.page);

  const [{ rows, total }, unread] = await Promise.all([
    loadNotificationsPage(page),
    countUnreadNotifications(),
  ]);
  const items = rows.map((r) => mapNotification(r, tFeed));
  const totalPages = Math.max(1, Math.ceil(total / NOVEDADES_PAGE_SIZE));

  function pageHref(p: number): string {
    return p > 1 ? `/novedades?page=${p}` : '/novedades';
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {unread > 0 ? (
          <MarkAllReadButton label={tFeed('mark_all')} pendingLabel={tFeed('marking')} />
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Bell className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-sm">
            <NotificationFeedList items={items} locale={locale} />
          </CardContent>
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('page_of', { current: page, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)}>{t('prev')}</Link>
              </Button>
            ) : null}
            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)}>{t('next')}</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
