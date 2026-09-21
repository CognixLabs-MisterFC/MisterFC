'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { signInWithPassword, type SigninFormState } from './actions';

export function SigninForm({
  locale,
  initialError,
}: {
  locale: string;
  /** Lo que pasó ANTES de llegar aquí; hoy solo `callback_failed`. */
  initialError?: SigninFormState['error'];
}) {
  const t = useTranslations('auth.signin');
  // Va como estado INICIAL y no como un aviso aparte: así el primer intento de
  // entrar lo sustituye solo, en vez de dejar dos mensajes a la vez en pantalla.
  const [state, formAction, isPending] = useActionState<SigninFormState, FormData>(
    signInWithPassword.bind(null, locale),
    { error: initialError },
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

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('password_label')}</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
      </label>

      {state.error === 'callback_failed' && (
        <p role="alert" className="text-sm text-amber-400">
          {t('error_callback_failed')}
        </p>
      )}
      {state.error === 'invalid_input' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_invalid_input')}
        </p>
      )}
      {state.error === 'invalid_credentials' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_invalid_credentials')}
        </p>
      )}
      {state.error === 'email_not_confirmed' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_email_not_confirmed')}
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
