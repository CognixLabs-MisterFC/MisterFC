import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { loadShellContext } from '@/lib/auth-shell';
import { rewriteStaleActiveClub } from '@/components/shell/actions';
import { AppShell } from '@/components/shell/app-shell';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function AuthenticatedLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) {
    // Sin sesión o sin clubs. Decidir destino con una carga más barata: si
    // hay user, falta club → /onboarding; si no, falta sesión → /signin.
    const { loadAuthOnly } = await import('@/lib/auth-shell');
    const auth = await loadAuthOnly();
    redirect(auth ? `/${locale}/onboarding` : `/${locale}/signin`);
  }

  if (ctx.staleCookie) {
    await rewriteStaleActiveClub(ctx.activeClub.club.id);
  }

  return (
    <AppShell ctx={ctx} locale={locale}>
      {children}
    </AppShell>
  );
}
