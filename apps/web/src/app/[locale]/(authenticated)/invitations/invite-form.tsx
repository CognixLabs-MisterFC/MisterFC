'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { sendInvitation, type SendInvitationFormState } from './actions';

export type InviteFormTeam = { id: string; name: string };

export function InviteForm({
  locale,
  isOwner,
  teams,
}: {
  locale: string;
  /** F1B-3c — solo el owner del club puede invitar a un rol ALTO (director). */
  isOwner: boolean;
  /**
   * Equipos de la temporada activa para el selector OPCIONAL de equipo. La
   * invitación queda atada al equipo elegido (o "Sin equipo" si no se elige).
   * El equipo es opcional SIEMPRE, sea cual sea el rol (decisión Jose).
   */
  teams: InviteFormTeam[];
}) {
  const t = useTranslations('invitations.form');
  const [state, formAction, isPending] = useActionState<
    SendInvitationFormState,
    FormData
  >(sendInvitation.bind(null, locale), {});

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-4">
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
        <span className="text-sm font-medium text-zinc-200">{t('role_label')}</span>
        <select
          name="role"
          defaultValue="entrenador_principal"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        >
          {/* Rol ALTO: 'director' solo se OFRECE al owner (F1B-3c). El gate real
              lo impone el server action + RLS (F1B-2). 'admin_club' NO se ofrece:
              el admin/owner ya existe y no se crean nuevos por invitación. */}
          {isOwner && <option value="director">{t('role_director')}</option>}
          <option value="coordinador">{t('role_coordinador')}</option>
          <option value="entrenador_principal">{t('role_entrenador_principal')}</option>
          <option value="entrenador_ayudante">{t('role_entrenador_ayudante')}</option>
          <option value="jugador">{t('role_jugador')}</option>
        </select>
      </label>

      {/* Equipo OPCIONAL para cualquier rol. Vacío → invitación "Sin equipo". */}
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('team_label')}</span>
        <select
          name="team_id"
          defaultValue=""
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        >
          <option value="">{t('team_none')}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>

      {state.error === 'invalid_input' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_invalid_input')}
        </p>
      )}
      {state.error === 'forbidden' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_forbidden')}
        </p>
      )}
      {state.error === 'no_club' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_no_club')}
        </p>
      )}
      {state.error === 'generic' && (
        <p role="alert" className="text-sm text-red-400">
          {t('error_generic')}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-sm text-emerald-400">
          {t('ok', { email: state.ok.email })}
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
