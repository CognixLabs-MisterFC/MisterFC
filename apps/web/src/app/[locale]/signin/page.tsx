import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { SigninForm } from './signin-form';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function SigninPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (user) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('auth.signin');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div>
          <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
          <p className="mt-2 text-sm text-zinc-300">{t('subtitle')}</p>
        </div>
        <SigninForm locale={locale} />
        <div className="flex flex-col gap-2 text-sm text-zinc-400">
          <Link
            href={`/${locale}/forgot-password`}
            className="underline underline-offset-4 hover:text-white"
          >
            {t('forgot_password_link')}
          </Link>
        </div>
      </div>
    </main>
  );
}
