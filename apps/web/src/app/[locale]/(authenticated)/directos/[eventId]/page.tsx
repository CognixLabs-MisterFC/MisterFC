import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { loadMatchDetail } from '../queries';
import { DirectoDetailClient } from './directo-detail-client';

type Props = { params: Promise<{ locale: string; eventId: string }> };

/**
 * F7B-3 — Detalle de un partido (SOLO LECTURA): campo, estadísticas, eventos y
 * minuto+estado en vivo (matchPhase + polling ~5s). La RLS de F7B-2 permite la
 * lectura a cualquier miembro del club; el aislamiento entre clubs lo comprueba
 * loadMatchDetail (club_id del evento).
 */
export default async function DirectoDetailPage({ params }: Props) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('directos');
  const detail = await loadMatchDetail(ctx.activeClub.club.id, eventId);
  if (!detail) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/directos">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <DirectoDetailClient initial={detail} />
    </div>
  );
}
