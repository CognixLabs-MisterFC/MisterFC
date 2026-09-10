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
import { RemovedMembershipBanner } from '@/components/shell/removed-membership-banner';
import { AccountDeletionPending } from '@/components/shell/account-deletion-pending';

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

  // El cliente RLS del usuario: lo usan las tres comprobaciones que vienen (borrado en
  // curso, invitación pendiente y baja), así que se crea una sola vez aquí.
  const supabase = createSupabaseServerClient(adapter);

  // BC-4 — un borrado de cuenta EN CURSO manda sobre todo lo demás, y por eso se mira
  // lo primero:
  //  · antes que la invitación pendiente, porque si no, a quien recibiera una invitación
  //    mientras se borra lo mandaríamos a aceptarla; se haría de un club otra vez y no
  //    volvería a ver esta pantalla, pero el cron lo borraría igual a los 30 días;
  //  · antes que el banner de baja, porque pedir el borrado pone `left_at` en todas sus
  //    memberships y `my_removed_memberships` también devolvería filas: le diríamos que
  //    le ha dado de baja el club, que es falso, y encima le esconderíamos el botón de
  //    cancelar.
  // Cuesta una RPC extra solo en el camino de los clubless, que ya es el raro.
  const { data: deletion } = await supabase.rpc('my_account_deletion_status');
  const pendingDeletion = deletion?.[0];
  if (pendingDeletion) {
    return (
      <OnboardingShell locale={locale}>
        <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <AccountDeletionPending
            deadlineAt={pendingDeletion.deadline_at}
            pendingPlayers={pendingDeletion.pending_players}
          />
          <LogoutButton locale={locale} variant="outline" />
        </div>
      </OnboardingShell>
    );
  }

  // Si tiene una invitación pendiente válida, le reencaminamos a aceptarla.
  // La policy de invitations ya restringe a invitaciones cuyo email coincida
  // con el del user. ESTE es el camino del invitado — no se toca.
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

  // Baja de miembros (4c): si el clubless llegó aquí por una BAJA (no por ser nuevo),
  // se lo decimos. La RPC solo se llama en este dead-end — un usuario con club activo ya
  // fue redirigido a `/` arriba, así que nunca pasa por aquí (coste cero para el normal).
  const { data: removed } = await supabase.rpc('my_removed_memberships');
  if (removed && removed.length > 0) {
    return (
      <OnboardingShell locale={locale}>
        <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <RemovedMembershipBanner items={removed} />
          <LogoutButton locale={locale} variant="outline" />
        </div>
      </OnboardingShell>
    );
  }

  // Clubless SIN baja (usuario nuevo sin invitación): dead-end de siempre, EXACTAMENTE
  // igual que hoy. No hay autoservicio de crear club.
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
