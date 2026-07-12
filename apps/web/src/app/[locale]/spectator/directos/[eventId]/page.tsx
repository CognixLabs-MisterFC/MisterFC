import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadMatchDetail } from '@/app/[locale]/(authenticated)/directos/queries';
import { DirectoDetailClient } from '@/app/[locale]/(authenticated)/directos/[eventId]/directo-detail-client';

type Props = { params: Promise<{ locale: string; eventId: string }> };

/**
 * F14C-4 — Detalle de un directo para el seguidor: REUTILIZA loadMatchDetail +
 * DirectoDetailClient. Aislamiento entre clubs lo garantiza loadMatchDetail
 * (club_id del evento) + la RLS de F14C-3 (is_spectator_of_club). Botón "atrás"
 * hacia /spectator/directos.
 */
export default async function SpectatorDirectoDetailPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadSpectatorContext();
  if (!ctx) redirect(`/${locale}/`);

  const t = await getTranslations('spectator');
  const detail = await loadMatchDetail(ctx.activePlayer.clubId, eventId);
  if (!detail) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/spectator/directos">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('directos.back')}</span>
          </Link>
        </Button>
      </div>

      <DirectoDetailClient initial={detail} />
    </div>
  );
}
