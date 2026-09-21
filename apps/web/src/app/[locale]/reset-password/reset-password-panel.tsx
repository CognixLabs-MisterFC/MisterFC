'use client';

import { useTranslations } from 'next-intl';
import { signout } from '@/app/[locale]/actions';
import { ResetPasswordForm } from './reset-password-form';

/**
 * La pantalla de fijar contraseña nueva. Cliente porque la pintan DOS sitios:
 * la página (cuando el servidor ya ve la sesión en las cookies) y el gate
 * (cuando la sesión llegó en el fragmento y solo existe en el navegador).
 *
 * LA SALIDA. Cerrar sesión desde aquí existe porque en cuanto el candado esté
 * puesto —cambiar la contraseña deja de ser opcional— esta pantalla es la única
 * a la que se puede llegar, y sin una puerta quien se arrepienta se queda
 * encerrado hasta que caduque el enlace (una hora, `mailer_otp_exp`).
 *
 * Y es COMODIDAD, no un agujero, porque pedir el enlace NO invalida la
 * contraseña anterior (decisión de producto): quien cierre sesión aquí entra con
 * la de siempre. Por eso el texto lo dice en vez de insinuar que pierde algo.
 *
 * No se reutiliza `LogoutButton` a propósito: es un componente de servidor
 * (`async` + `getTranslations`) y el gate, que también pinta este panel, es
 * cliente. La acción es la misma.
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
        <form action={signout.bind(null, locale)} className="flex flex-col items-center gap-1">
          <p className="text-xs text-zinc-400">{t('signout_hint')}</p>
          <button
            type="submit"
            className="text-sm text-zinc-300 underline underline-offset-4 transition hover:text-white"
          >
            {t('signout')}
          </button>
        </form>
      </div>
    </main>
  );
}
