import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  getCurrentUser,
  getCurrentUserClubs,
  createSupabaseServerClient,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { InviteForm } from './invite-form';
import { CancelInvitationButton } from './cancel-invitation-button';

type Props = {
  params: Promise<{ locale: string }>;
};

// director accede a la página de invitaciones (invita roles bajos). Mostrar/ocultar
// la opción 'director' según sea owner es F1B-3; el gate de alto es server-side + RLS.
const ROLES_ALLOWED_TO_INVITE: Role[] = ['admin_club', 'director', 'coordinador'];

export default async function InvitationsPage({ params }: Props) {
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

  const authorized = clubs.find((c) => ROLES_ALLOWED_TO_INVITE.includes(c.role));
  if (!authorized) {
    redirect(`/${locale}`);
  }

  const supabase = createSupabaseServerClient(adapter);
  const { data: invitations } = await supabase
    .from('invitations')
    .select('id, email, role, expires_at, accepted_at, created_at')
    .eq('club_id', authorized.club.id)
    .order('created_at', { ascending: false });

  const t = await getTranslations('invitations');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-12 text-white">
      <header>
        <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {t('subtitle', { club: authorized.club.name })}
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-400">
          {t('new_section_title')}
        </h2>
        <InviteForm locale={locale} />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-400">
          {t('list_section_title')}
        </h2>
        {!invitations || invitations.length === 0 ? (
          <p className="text-sm text-zinc-400">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invitations.map((inv) => {
              const expired = !inv.accepted_at && new Date(inv.expires_at) < new Date();
              const status = inv.accepted_at
                ? t('status_accepted')
                : expired
                  ? t('status_expired')
                  : t('status_pending');
              const cancellable = !inv.accepted_at;
              return (
                <li
                  key={inv.id}
                  className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium text-white">{inv.email}</div>
                    <div className="text-xs text-zinc-400">{inv.role}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">{status}</span>
                    {cancellable && (
                      <CancelInvitationButton
                        locale={locale}
                        invitationId={inv.id}
                        email={inv.email}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
