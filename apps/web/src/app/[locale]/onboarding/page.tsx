import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  getCurrentUser,
  getCurrentUserClubs,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { OnboardingShell } from '@/components/shell/onboarding-shell';
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

  // Si tiene una invitación pendiente válida, le redirigimos a aceptarla
  // antes que dejarle crear un club nuevo por error. La policy de invitations
  // ya restringe a invitaciones cuyo email coincida con el del user.
  const supabase = createSupabaseServerClient(adapter);
  const { data: pendingInvite } = await supabase
    .from('invitations')
    .select('token')
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingInvite?.token) {
    redirect(`/${locale}/invite/${pendingInvite.token}`);
  }

  const t = await getTranslations('onboarding');

  return (
    <OnboardingShell locale={locale}>
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-misterfc-green">{t('title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <OnboardingForm locale={locale} />
      </div>
    </OnboardingShell>
  );
}
