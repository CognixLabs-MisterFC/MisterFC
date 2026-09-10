import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { OnboardingShell } from '@/components/shell/onboarding-shell';
import { Button } from '@/components/ui/button';

/**
 * BC-4 — "Tu cuenta ha sido eliminada". Pantalla PÚBLICA: cuando se llega aquí la sesión
 * ya está cerrada y la cuenta anonimizada, así que no puede vivir bajo (authenticated).
 *
 * Es el plano final del vídeo para Apple: el revisor confirma el borrado y aterriza aquí.
 * No lleva ningún camino de vuelta a la cuenta — solo al inicio de sesión, donde sus
 * credenciales ya no valen.
 */
export default async function CuentaEliminadaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account_deletion');

  return (
    <OnboardingShell locale={locale}>
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-misterfc-green">{t('done_title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('done_body')}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/${locale}/signin`}>{t('done_back')}</Link>
        </Button>
      </div>
    </OnboardingShell>
  );
}
