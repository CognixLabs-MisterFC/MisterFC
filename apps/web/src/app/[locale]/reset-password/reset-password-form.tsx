'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { resetPassword, type ResetPasswordFormState } from './actions';

export function ResetPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations('auth.reset_password');
  const [state, formAction, isPending] = useActionState<ResetPasswordFormState, FormData>(
    resetPassword.bind(null, locale),
    {},
  );

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const clientMismatch = password.length > 0 && confirm.length > 0 && password !== confirm;

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('password_label')}</span>
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
        <span className="text-xs text-zinc-500">{t('password_hint')}</span>
      </label>

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('confirm_label')}</span>
        <input
          type="password"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
      </label>

      {clientMismatch && (
        <p role="alert" className="text-sm text-amber-400">
          {t('error_password_mismatch')}
        </p>
      )}
      {state.error === 'invalid_input' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_invalid_input')}
        </p>
      )}
      {state.error === 'password_too_short' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_password_too_short')}
        </p>
      )}
      {state.error === 'password_mismatch' && !clientMismatch && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_password_mismatch')}
        </p>
      )}
      {state.error === 'no_session' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_no_session')}
        </p>
      )}
      {state.error === 'generic' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_generic')}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || clientMismatch}
        className="rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371] disabled:opacity-60"
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
