import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Bell } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadFollowableTeams } from './queries';
import { FollowListClient } from './follow-list-client';

type Props = { params: Promise<{ locale: string }> };

/**
 * F7B-P1 — "Seguir equipos": el usuario ve TODOS los equipos de su club y marca
 * cuáles seguir para recibir push de sus goles. Accesible desde la cabecera de
 * Directos. No afecta a lo que se ve en Directos (esa pantalla es abierta).
 */
export default async function SeguirEquiposPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('directos.follow');
  const teams = await loadFollowableTeams(ctx.activeClub.club.id, ctx.user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/directos">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Bell className="size-6" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <FollowListClient initialTeams={teams} />
    </div>
  );
}
