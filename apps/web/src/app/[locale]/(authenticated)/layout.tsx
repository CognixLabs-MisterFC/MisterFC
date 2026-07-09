import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
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

  // F14-5 — GATE de re-consentimiento por temporada (guard SERVER-SIDE). Un tutor
  // (parent/guardian) sin T&C + Privacidad para la temporada ACTIVA no puede
  // navegar a ninguna ruta autenticada: se le redirige a la pantalla de
  // re-consentimiento (fuera de este layout, sin bucle). El staff nunca es tutor →
  // `tutor_needs_reconsent` devuelve false y no se ve afectado.
  {
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);
    const { data: needsReconsent } = await supabase.rpc('tutor_needs_reconsent', {
      p_club_id: ctx.activeClub.club.id,
    });
    if (needsReconsent) {
      redirect(`/${locale}/re-consentimiento`);
    }
  }

  return (
    <AppShell ctx={ctx} locale={locale}>
      {children}
    </AppShell>
  );
}
