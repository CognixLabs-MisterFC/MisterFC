import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  getCurrentUser,
  getCurrentUserClubs,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { OnboardingShell } from '@/components/shell/onboarding-shell';
import { LogoutButton } from '@/components/shell/logout-button';

type Props = {
  params: Promise<{ locale: string }>;
};

/**
 * /onboarding — REENCAMINADOR del usuario autenticado SIN club.
 *
 * Ya NO existe autoservicio de crear club (F15-C2-followup): desde F14D el
 * registro está cerrado y los clubes los crea Jose desde la consola. Esta
 * pantalla solo decide a dónde va un clubless:
 *   - con invitación pendiente válida → /invite/{token} (el alta real, #372).
 *   - sin invitación → dead-end informativo (mensaje + cerrar sesión). NO hay
 *     forma de crear un club por aquí.
 * El redirect que trae aquí a los clubless vive en (authenticated)/layout.tsx.
 */
export default async function OnboardingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  // Si ya tiene memberships, esta página no aplica.
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length > 0) {
    redirect(`/${locale}`);
  }

  // Si tiene una invitación pendiente válida, le reencaminamos a aceptarla.
  // La policy de invitations ya restringe a invitaciones cuyo email coincida
  // con el del user. ESTE es el camino del invitado — no se toca.
  const supabase = createSupabaseServerClient(adapter);
  const { data: pendingInvite } = await supabase
    .from('invitations')
    .select('token')
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingInvite?.token) {
    redirect(`/${locale}/invite/${pendingInvite.token}`);
  }

  // Clubless SIN invitación: dead-end. No hay autoservicio de crear club.
  const t = await getTranslations('onboarding');

  return (
    <OnboardingShell locale={locale}>
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-misterfc-green">{t('no_club_title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('no_club_body')}</p>
        </div>
        <LogoutButton locale={locale} variant="outline" />
      </div>
    </OnboardingShell>
  );
}
