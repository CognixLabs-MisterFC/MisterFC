import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { ResetPasswordPanel } from './reset-password-panel';
import { ResetPasswordGate } from './reset-password-gate';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ResetPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);

  if (user) {
    return <ResetPasswordPanel locale={locale} />;
  }

  const t = await getTranslations('auth.reset_password');

  // Sin sesión EN EL SERVIDOR no significa sin sesión (BUG-4): si el correo vino
  // por el flujo implícito, los tokens viajan en el fragmento de la URL y solo
  // los ve el navegador. Lo decide el cliente; hasta entonces, "un momento…".
  return (
    <ResetPasswordGate locale={locale}>
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          <h1 className="text-2xl font-bold text-red-400">{t('no_session_title')}</h1>
          <p className="text-sm text-zinc-300">{t('no_session_body')}</p>
          <Link
            href={`/${locale}/forgot-password`}
            className="mt-4 rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371]"
          >
            {t('no_session_cta')}
          </Link>
        </div>
      </main>
    </ResetPasswordGate>
  );
}
