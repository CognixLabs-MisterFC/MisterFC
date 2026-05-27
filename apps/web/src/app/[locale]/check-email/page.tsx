import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';

type Context = 'signup' | 'reset';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    email?: string | string[];
    context?: string | string[];
  }>;
};

function parseContext(raw: string | string[] | undefined): Context {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'reset' ? 'reset' : 'signup';
}

/**
 * Pantalla pasiva que muestra "te hemos enviado un email" tras signup o tras
 * pedir reset de contraseña. La página no interactúa con Supabase — se limita
 * a explicar al user qué esperar y darle un atajo a /signin.
 *
 * Distingue 2 contextos:
 *  - `signup`: tras crear cuenta, el email contiene el link de verificación.
 *  - `reset`: tras pedir reset de contraseña, el email contiene el link al form
 *    de nueva contraseña.
 *
 * El flujo de invitación NO pasa por aquí: el invitee va directo a /invite/{token}
 * desde el email.
 */
export default async function CheckEmailPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const context = parseContext(sp.context);
  const t = await getTranslations(`auth.check_email.${context}`);
  const tCommon = await getTranslations('auth.check_email');

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
          {tCommon('back_to_signin')}
        </Link>
      </div>
    </main>
  );
}
