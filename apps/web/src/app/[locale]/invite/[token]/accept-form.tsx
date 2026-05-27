'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { acceptInvitation, type AcceptInvitationState } from './actions';

export function AcceptForm({
  locale,
  token,
  clubName,
  role,
}: {
  locale: string;
  token: string;
  clubName: string;
  role: string;
}) {
  const t = useTranslations('invite');
  const [state, formAction, isPending] = useActionState<
    AcceptInvitationState,
    FormData
  >(async () => acceptInvitation(locale, token), {});

  return (
    <form action={formAction} className="flex flex-col items-center gap-4">
      <p className="text-sm text-zinc-300">{t('summary', { club: clubName, role })}</p>

      {state.error === 'wrong_email' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_wrong_email')}
        </p>
      )}
      {state.error === 'expired' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_expired')}
        </p>
      )}
      {state.error === 'already_accepted' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_already_accepted')}
        </p>
      )}
      {state.error === 'not_found' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_not_found')}
        </p>
      )}
      {state.error === 'generic' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_generic')}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371] disabled:opacity-60"
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
