import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser, chooseInviteForm } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadInvitationForPage } from './invite-data';
import { AcceptForm, AcceptWithProfileForm, SignInToAcceptForm } from './accept-form';

type Props = {
  params: Promise<{ locale: string; token: string }>;
};

function ErrorScreen({ message, tone = 'red' }: { message: string; tone?: 'red' | 'zinc' }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <h1 className={`text-2xl font-bold ${tone === 'red' ? 'text-red-400' : 'text-zinc-300'}`}>
        {message}
      </h1>
    </main>
  );
}

/**
 * Página de aceptación de invitación — Rework B · B2.
 *
 * El TOKEN es la credencial: la página funciona SOLO con el token, sin exigir
 * sesión previa ni pasar por /signin ni por el magic link. Aunque el magic link
 * de Supabase haya caducado, /invite/{token} sigue operativo.
 *
 * Validamos el token con el cliente service_role (loadInvitationByToken) y, según
 * el estado REAL, elegimos uno de tres formularios:
 *
 *   1. Usuario YA configurado (con contraseña) cuyo email coincide → AcceptForm
 *      (1 click). P.ej. un usuario existente aceptando una invitación adicional.
 *   2. Invitee NUEVO (cuenta no reclamada que creamos, invited_user_id) →
 *      AcceptWithProfileForm: nombre + contraseña UNA vez. SIEMPRE, aunque ya
 *      tenga sesión del magic link (si no, entraría sin credenciales: B2b).
 *   3. Email con cuenta preexistente (invited_user_id == null) y sin sesión →
 *      SignInToAcceptForm: inicia sesión con su contraseña; el token le adjunta.
 *
 * La decisión vive en `chooseInviteForm` (@misterfc/core), pura y testeada.
 */
export default async function InvitePage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('invite');

  // Validación del token (sin sesión). El email se comprueba más abajo solo en
  // la rama "ya hay sesión".
  const { invitation: inv, verdict } = await loadInvitationForPage(token);
  if (verdict === 'not_found' || !inv || !inv.club_name) {
    return <ErrorScreen message={t('error_not_found')} />;
  }
  if (verdict === 'already_accepted') {
    return <ErrorScreen message={t('error_already_accepted')} tone="zinc" />;
  }
  if (verdict === 'expired') {
    return <ErrorScreen message={t('error_expired')} />;
  }

  // Estado de la sesión actual (si la hay) para decidir el formulario.
  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  const sessionEmailMatches =
    !!user?.email &&
    user.email.trim().toLowerCase() === inv.email.trim().toLowerCase();
  const invitePending =
    (user?.app_metadata as { invite_pending?: boolean } | undefined)
      ?.invite_pending === true;

  const choice = chooseInviteForm({
    invitedUserId: inv.invited_user_id,
    sessionUserId: user?.id ?? null,
    sessionEmailMatches,
    invitePending,
  });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
        {choice === 'quick' ? (
          <AcceptForm
            locale={locale}
            token={token}
            clubName={inv.club_name}
            role={inv.role}
            invitedEmail={inv.email}
          />
        ) : choice === 'set_password' ? (
          <AcceptWithProfileForm
            locale={locale}
            token={token}
            clubName={inv.club_name}
            role={inv.role}
            invitedEmail={inv.email}
          />
        ) : (
          <SignInToAcceptForm
            locale={locale}
            token={token}
            clubName={inv.club_name}
            role={inv.role}
            invitedEmail={inv.email}
          />
        )}
      </div>
    </main>
  );
}
