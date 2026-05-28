import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { LogoutButton } from './logout-button';

type Props = {
  locale: string;
  children: ReactNode;
};

/**
 * Header minimal para /onboarding: solo nombre de app + botón Cerrar sesión.
 * Resuelve el known-issue de F1 donde un user sin club quedaba atrapado.
 */
export async function OnboardingShell({ locale, children }: Props) {
  const t = await getTranslations('shell');

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 text-zinc-100">
        <span className="text-xl font-bold tracking-tight text-misterfc-green">
          {t('app_name')}
        </span>
        <LogoutButton locale={locale} variant="ghost" />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-6">
        {children}
      </main>
    </div>
  );
}
