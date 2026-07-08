import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Radio, Bell } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadWeekMatches } from './queries';
import { DirectosListClient } from './directos-list-client';

type Props = { params: Promise<{ locale: string }> };

/**
 * F7B-3 — "Directos": partidos de la semana natural del club (todos los roles,
 * SOLO LECTURA). La lista se refresca por polling ~5s para los partidos en vivo.
 */
export default async function DirectosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('directos');
  const matches = await loadWeekMatches(ctx.activeClub.club.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radio className="size-6" aria-hidden />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/directos/seguir">
            <Bell className="size-4" aria-hidden />
            <span>{t('follow.cta')}</span>
          </Link>
        </Button>
      </div>

      <DirectosListClient locale={locale} initialMatches={matches} />
    </div>
  );
}
