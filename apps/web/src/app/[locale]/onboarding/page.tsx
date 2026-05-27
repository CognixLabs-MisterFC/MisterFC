import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser, getCurrentUserClubs } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { OnboardingForm } from './onboarding-form';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function OnboardingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  // Si ya tiene memberships, esta página no aplica.
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length > 0) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('onboarding');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div>
          <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
          <p className="mt-2 text-sm text-zinc-300">{t('subtitle')}</p>
        </div>
        <OnboardingForm locale={locale} />
      </div>
    </main>
  );
}
