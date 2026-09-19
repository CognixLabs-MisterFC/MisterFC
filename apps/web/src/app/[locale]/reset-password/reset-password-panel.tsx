'use client';

import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from './reset-password-form';

/**
 * La pantalla de fijar contraseña nueva. Cliente porque la pintan DOS sitios:
 * la página (cuando el servidor ya ve la sesión en las cookies) y el gate
 * (cuando la sesión llegó en el fragmento y solo existe en el navegador).
 */
export function ResetPasswordPanel({ locale }: { locale: string }) {
  const t = useTranslations('auth.reset_password');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div>
          <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
          <p className="mt-2 text-sm text-zinc-300">{t('subtitle')}</p>
        </div>
        <ResetPasswordForm locale={locale} />
      </div>
    </main>
  );
}
