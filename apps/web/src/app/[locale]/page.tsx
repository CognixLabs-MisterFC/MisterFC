import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser, getCurrentUserClubs } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { signout } from './actions';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length === 0) {
    redirect(`/${locale}/onboarding`);
  }

  const t = await getTranslations();
  const signoutAction = signout.bind(null, locale);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="text-5xl font-bold tracking-tight text-[#10B981]">
          {t('common.app_name')}
        </h1>

        <p className="text-sm text-zinc-300">
          {t('home.signed_in_as', { email: user.email ?? '' })}
        </p>

        <section className="w-full text-left">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">
            {t('home.your_clubs')}
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {clubs.map((c) => (
              <li
                key={c.membershipId}
                className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2"
              >
                <div className="font-medium text-white">{c.club.name}</div>
                <div className="text-xs text-zinc-400">{c.role}</div>
              </li>
            ))}
          </ul>
        </section>

        <form action={signoutAction}>
          <button
            type="submit"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-white hover:text-white"
          >
            {t('home.signout')}
          </button>
        </form>
      </div>
    </main>
  );
}
