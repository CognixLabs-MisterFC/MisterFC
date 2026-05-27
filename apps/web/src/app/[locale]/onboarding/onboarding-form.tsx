'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createClub, type CreateClubFormState } from './actions';

export function OnboardingForm({ locale }: { locale: string }) {
  const t = useTranslations('onboarding');
  const [state, formAction, isPending] = useActionState<CreateClubFormState, FormData>(
    createClub.bind(null, locale),
    {}
  );

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('club_name_label')}</span>
        <input
          type="text"
          name="name"
          required
          maxLength={120}
          placeholder={t('club_name_placeholder')}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
      </label>

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('club_locale_label')}</span>
        <select
          name="club_locale"
          defaultValue={locale}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        >
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="va">Valencià</option>
        </select>
      </label>

      {state.error === 'name_required' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_name_required')}
        </p>
      )}
      {state.error === 'slug_collision' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_slug_collision')}
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
