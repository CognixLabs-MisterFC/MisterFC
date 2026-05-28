import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ForgotPasswordForm } from './forgot-password-form';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth.forgot_password');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div>
          <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
          <p className="mt-2 text-sm text-zinc-300">{t('subtitle')}</p>
        </div>
        <ForgotPasswordForm locale={locale} />
        <Link
          href={`/${locale}/signin`}
          className="text-sm text-zinc-400 underline underline-offset-4 hover:text-white"
        >
          {t('back_to_signin')}
        </Link>
      </div>
    </main>
  );
}
