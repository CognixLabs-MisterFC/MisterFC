import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { AcceptForm, AcceptWithProfileForm } from './accept-form';

type Props = {
  params: Promise<{ locale: string; token: string }>;
};

/**
 * Página de aceptación de invitación.
 *
 * 3 ramas según estado del invitee:
 *  1. No autenticado → redirect a /signin?next=/invite/{token}.
 *  2. Autenticado y email confirmado pero sin password (vino del email de
 *     Supabase Invite) → AcceptWithPasswordForm: fija password + acepta.
 *  3. Autenticado y con password (ya pertenecía a otro club o se registró
 *     previamente con email+password) → AcceptForm: 1 click para aceptar.
 *
 * Distinguir 2 vs 3 sin acceso al hash de password requiere usar el flag
 * `user.app_metadata.provider`. Cuando Supabase manda el invite, el user
 * queda con `app_metadata.providers = ['email']` y `user_metadata` vacío
 * mientras NO haya completado un setup de password. La señal más fiable es
 * comprobar si `last_sign_in_at` viene de la primera sesión (OTP redemption)
 * y aún no ha tenido un sign-in real con password.
 *
 * Heurística práctica: si `user.app_metadata.invite_pending === true`
 * (custom flag que el server action `sendInvitation` puede setear via
 * `data: { invite_pending: true }`), mostramos form de password.
 * Mientras no exista ese flag, fallback: si el user no tiene memberships
 * en ningún club, mostramos form de password (es un invitee nuevo).
 */
export default async function InvitePage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) {
    redirect(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
  }

  const supabase = createSupabaseServerClient(adapter);
  const { data: inv } = await supabase
    .from('invitations')
    .select('id, email, role, accepted_at, expires_at, club:club_id(id, name)')
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
        <h1 className="text-2xl font-bold text-zinc-300">{t('error_already_accepted')}</h1>
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

  // Detectar si el invitee aún no ha establecido password. El metadato
  // `invite_pending` lo setea sendInvitation al llamar a inviteUserByEmail.
  // Se limpia al final del flujo `acceptInvitationWithPassword`.
  const invitePending =
    user.app_metadata &&
    (user.app_metadata as { invite_pending?: boolean }).invite_pending === true;

  // Fallback heurístico (por si el metadato no se propagó por timing): si
  // el invitee no tiene memberships todavía y su única identidad es email
  // recién creada (no ha hecho sign-in con password), asumimos pending.
  const { count: membershipsCount } = await supabase
    .from('memberships')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', user.id);
  const needsPassword = invitePending === true || (membershipsCount ?? 0) === 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
        {needsPassword ? (
          <AcceptWithProfileForm
            locale={locale}
            token={token}
            clubName={inv.club.name}
            role={inv.role}
            invitedEmail={inv.email}
          />
        ) : (
          <AcceptForm
            locale={locale}
            token={token}
            clubName={inv.club.name}
            role={inv.role}
            invitedEmail={inv.email}
          />
        )}
      </div>
    </main>
  );
}
