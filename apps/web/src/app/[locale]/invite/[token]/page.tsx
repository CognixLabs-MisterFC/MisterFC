import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { AcceptForm } from './accept-form';

type Props = {
  params: Promise<{ locale: string; token: string }>;
};

export default async function InvitePage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) {
    redirect(
      `/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`
    );
  }

  const supabase = createSupabaseServerClient(adapter);
  const { data: inv } = await supabase
    .from('invitations')
    .select(
      'id, email, role, accepted_at, expires_at, club:club_id(id, name)'
    )
    .eq('token', token)
    .maybeSingle<{
      id: string;
      email: string;
      role: string;
      accepted_at: string | null;
      expires_at: string;
      club: { id: string; name: string } | null;
    }>();

  const t = await getTranslations('invite');

  if (!inv || !inv.club) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
        <h1 className="text-2xl font-bold text-red-400">{t('error_not_found')}</h1>
      </main>
    );
  }

  if (inv.accepted_at) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
        <h1 className="text-2xl font-bold text-zinc-300">
          {t('error_already_accepted')}
        </h1>
      </main>
    );
  }

  if (new Date(inv.expires_at) < new Date()) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
        <h1 className="text-2xl font-bold text-red-400">{t('error_expired')}</h1>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
        <AcceptForm
          locale={locale}
          token={token}
          clubName={inv.club.name}
          role={inv.role}
        />
      </div>
    </main>
  );
}
