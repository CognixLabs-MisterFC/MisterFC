import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string | string[] }>;
};

export default async function CheckEmailPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('auth.check_email');

  const rawEmail = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  const email = rawEmail?.trim();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="max-w-md">
        <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
        <p className="mt-4 text-sm text-zinc-300">
          {email ? t('body', { email }) : t('body_fallback')}
        </p>
        <Link
          href={`/${locale}/signin`}
          className="mt-8 inline-block text-sm text-zinc-400 underline underline-offset-4 hover:text-white"
        >
          {t('back_to_signin')}
        </Link>
      </div>
    </main>
  );
}
