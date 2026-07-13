import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BookOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

type Props = { params: Promise<{ locale: string }> };

/**
 * F14E-1 — PLACEHOLDER de "Playbook" (menú del jugador). El Playbook es una
 * feature NUEVA fuera de F14E; aquí solo se deja el hueco/entrada con un stub
 * "próximamente" para que la navegación no rompa al pulsarla. La pantalla real
 * llegará en su fase propia.
 */
export default async function PlaybookPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('playbook');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <BookOpen className="size-6" aria-hidden />
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <BookOpen className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-lg font-medium">{t('coming_soon')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t('subtitle')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
