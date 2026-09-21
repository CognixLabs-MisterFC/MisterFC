import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { LegalFooter } from '@/components/legal/legal-footer';
import { SigninForm } from './signin-form';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SigninPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  /**
   * `/auth/callback` manda aquí con `?error=callback_failed` cuando no puede
   * completar el acceso: el enlace venía roto, caducado o ya usado.
   *
   * Hasta ahora ese parámetro no lo leía NADIE. El usuario aterrizaba en el login
   * sin una palabra sobre lo que acababa de pasar, y se quedaba probando una
   * contraseña que no era el problema. El motivo sí se reportaba —a Sentry—, o sea
   * que lo sabíamos nosotros y no él.
   *
   * Solo se reconoce ESE valor: el parámetro viene de una URL y cualquiera puede
   * escribir lo que quiera en él. Un código desconocido no pinta nada.
   */
  const { error } = await searchParams;
  const inicial = error === 'callback_failed' ? 'callback_failed' : undefined;

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
        <SigninForm locale={locale} initialError={inicial} />
        <div className="flex flex-col gap-2 text-sm text-zinc-400">
          <Link
            href={`/${locale}/forgot-password`}
            className="underline underline-offset-4 hover:text-white"
          >
            {t('forgot_password_link')}
          </Link>
        </div>
        <LegalFooter locale={locale} />
      </div>
    </main>
  );
}
