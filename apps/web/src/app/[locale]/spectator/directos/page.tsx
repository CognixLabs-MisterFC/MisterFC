import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Radio } from 'lucide-react';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { loadWeekMatches } from '@/app/[locale]/(authenticated)/directos/queries';
import { DirectosListClient } from '@/app/[locale]/(authenticated)/directos/directos-list-client';

type Props = { params: Promise<{ locale: string }> };

/**
 * F14C-4 — "Directos" del seguidor: REUTILIZA loadWeekMatches + DirectosListClient
 * de la pantalla de miembro. El seguidor ve los directos club-wide por RLS
 * (F14C-3). Sin botón "seguir" (gestión); enlaces de detalle bajo /spectator.
 */
export default async function SpectatorDirectosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadSpectatorContext();
  if (!ctx) redirect(`/${locale}/`);

  const t = await getTranslations('spectator');
  const matches = await loadWeekMatches(ctx.activePlayer.clubId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Radio className="size-6" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('directos.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('directos.subtitle')}
          </p>
        </div>
      </div>

      <DirectosListClient
        locale={locale}
        initialMatches={matches}
        detailBasePath="/spectator/directos"
      />
    </div>
  );
}
