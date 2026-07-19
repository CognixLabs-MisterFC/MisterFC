'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { loginToClub, type ClubLoginState } from './actions';

/**
 * Formulario del login-por-club. Misma base visual que el de /signin (mismos
 * inputs y estilos), pero apunta a `loginToClub` con el `clubId` del slug fijado.
 * Un ÚNICO mensaje de error para los tres casos posibles (i18n `clubLogin.error`).
 */
export function ClubLoginForm({
  locale,
  clubId,
}: {
  locale: string;
  clubId: string;
}) {
  const t = useTranslations('auth.signin');
  const tc = useTranslations('clubLogin');
  const [state, formAction, isPending] = useActionState<ClubLoginState, FormData>(
    loginToClub.bind(null, locale, clubId),
    {},
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

      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {tc('error')}
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
