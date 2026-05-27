'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { requestMagicLink, type SigninFormState } from './actions';

export function SigninForm({ locale }: { locale: string }) {
  const t = useTranslations('auth.signin');
  const [state, formAction, isPending] = useActionState<SigninFormState, FormData>(
    requestMagicLink.bind(null, locale),
    {}
  );

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('email_label')}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder={t('email_placeholder')}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
      </label>

      {state.error === 'invalid_email' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_invalid_email')}
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
