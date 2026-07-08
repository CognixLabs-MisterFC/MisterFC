'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  acceptInvitation,
  acceptNewInvitee,
  acceptExistingUser,
  type AcceptInvitationState,
} from './actions';
import { ConsentGate } from './consent-gate';
import type { AccountConsentDoc } from './consent-data';

/** F14-3a — un hijo pendiente de alta (para pintar una tarjeta por hijo). */
export type PendingChild = { playerName: string | null; teamName: string | null };

type CommonProps = {
  locale: string;
  token: string;
  clubName: string;
  role: string;
  invitedEmail: string;
  // F14-2 — consentimientos obligatorios de cuenta (T&C + Privacidad).
  legalTerms: AccountConsentDoc | null;
  legalPrivacy: AccountConsentDoc | null;
  preAcceptedTerms: boolean;
  preAcceptedPrivacy: boolean;
  // F14-3a — hijos pendientes de este email/club (alta multi-hijo).
  pendingChildren: PendingChild[];
};

/**
 * F14-3a — Resumen de los hijos que se darán de alta en este mismo paso. Solo
 * informativo: una tarjeta por hijo con su nombre y (si lo tiene) su equipo. El
 * backbone procesa TODAS las pendientes del email en este club al aceptar.
 */
function ChildrenSummary({ children }: { children: PendingChild[] }) {
  const t = useTranslations('invite');
  if (children.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-left">
      <p className="text-xs font-medium text-zinc-300">{t('children_heading')}</p>
      <ul className="flex flex-col gap-1">
        {children.map((child, i) => (
          <li key={i} className="text-sm text-white">
            <span className="font-medium">{child.playerName ?? t('child_unnamed')}</span>
            <span className="text-zinc-500">
              {' · '}
              {child.teamName ?? t('child_no_team')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Form para invitee que YA tiene password (porque pertenece a otro club o se
 * registró con anterioridad). No le pedimos nada salvo confirmar y, si aún no
 * los aceptó en versión vigente, los consentimientos de cuenta (F14-2).
 */
export function AcceptForm({
  locale,
  token,
  clubName,
  role,
  invitedEmail,
  legalTerms,
  legalPrivacy,
  preAcceptedTerms,
  preAcceptedPrivacy,
  pendingChildren,
}: CommonProps) {
  const t = useTranslations('invite');
  const [state, formAction, isPending] = useActionState<AcceptInvitationState, FormData>(
    async (prev, formData) => acceptInvitation(locale, token, prev, formData),
    {},
  );
  const [consentOk, setConsentOk] = useState(false);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="text-sm text-zinc-300">{t('summary', { club: clubName, role })}</p>
      <p className="text-xs text-zinc-500">{t('invited_email_hint', { email: invitedEmail })}</p>

      <ChildrenSummary children={pendingChildren} />

      <ConsentGate
        terms={legalTerms}
        privacy={legalPrivacy}
        preAcceptedTerms={preAcceptedTerms}
        preAcceptedPrivacy={preAcceptedPrivacy}
        onSatisfiedChange={setConsentOk}
      />

      {state.error && <ErrorMessage error={state.error} />}

      <button
        type="submit"
        disabled={isPending || !consentOk}
        className="rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371] disabled:opacity-60"
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}

/**
 * Form para invitee que viene del email de Supabase Invite y aún no ha fijado
 * contraseña ni datos de perfil. Pide:
 *   - email (readonly, prefilled desde la invitación)
 *   - full_name (obligatorio, >= 2 chars)
 *   - date_of_birth (opcional)
 *   - password (>=8 chars) + confirm
 *   - consentimientos de cuenta obligatorios (F14-2)
 *
 * Al submit: updateUser + UPDATE profiles + insert membership + accept invitation.
 */
export function AcceptWithProfileForm({
  locale,
  token,
  clubName,
  role,
  invitedEmail,
  legalTerms,
  legalPrivacy,
  preAcceptedTerms,
  preAcceptedPrivacy,
  pendingChildren,
}: CommonProps) {
  const t = useTranslations('invite');
  const [state, formAction, isPending] = useActionState<AcceptInvitationState, FormData>(
    async (prev, formData) => acceptNewInvitee(locale, token, prev, formData),
    {},
  );

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consentOk, setConsentOk] = useState(false);
  const clientMismatch = password.length > 0 && confirm.length > 0 && password !== confirm;

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-zinc-300">{t('set_password_summary', { club: clubName, role })}</p>

      <ChildrenSummary children={pendingChildren} />

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('email_label')}</span>
        <input
          type="email"
          value={invitedEmail}
          readOnly
          aria-readonly="true"
          className="cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-base text-zinc-400 outline-none"
        />
      </label>

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('full_name_label')}</span>
        <input
          type="text"
          name="full_name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          placeholder={t('full_name_placeholder')}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
      </label>

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">
          {t('date_of_birth_label')}{' '}
          <span className="text-xs font-normal text-zinc-500">{t('optional')}</span>
        </span>
        <input
          type="date"
          name="date_of_birth"
          autoComplete="bday"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
      </label>

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

      <ConsentGate
        terms={legalTerms}
        privacy={legalPrivacy}
        preAcceptedTerms={preAcceptedTerms}
        preAcceptedPrivacy={preAcceptedPrivacy}
        onSatisfiedChange={setConsentOk}
      />

      {clientMismatch && (
        <p role="alert" className="text-sm text-amber-400">
          {t('error_password_mismatch')}
        </p>
      )}
      {state.error && <ErrorMessage error={state.error} />}

      <button
        type="submit"
        disabled={isPending || clientMismatch || !consentOk}
        className="rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371] disabled:opacity-60"
      >
        {isPending ? t('set_password_submitting') : t('set_password_submit')}
      </button>
    </form>
  );
}

/**
 * Form para invitee cuyo email YA tenía cuenta (`invited_user_id` NULL). No le
 * fijamos contraseña por token: inicia sesión con la suya y el token le adjunta
 * al club. Pide email (readonly) + contraseña + consentimientos de cuenta (F14-2).
 */
export function SignInToAcceptForm({
  locale,
  token,
  clubName,
  role,
  invitedEmail,
  legalTerms,
  legalPrivacy,
  preAcceptedTerms,
  preAcceptedPrivacy,
  pendingChildren,
}: CommonProps) {
  const t = useTranslations('invite');
  const [state, formAction, isPending] = useActionState<AcceptInvitationState, FormData>(
    async (prev, formData) => acceptExistingUser(locale, token, prev, formData),
    {},
  );
  const [consentOk, setConsentOk] = useState(false);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-zinc-300">{t('signin_summary', { club: clubName, role })}</p>

      <ChildrenSummary children={pendingChildren} />

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('email_label')}</span>
        <input
          type="email"
          value={invitedEmail}
          readOnly
          aria-readonly="true"
          className="cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-base text-zinc-400 outline-none"
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

      <ConsentGate
        terms={legalTerms}
        privacy={legalPrivacy}
        preAcceptedTerms={preAcceptedTerms}
        preAcceptedPrivacy={preAcceptedPrivacy}
        onSatisfiedChange={setConsentOk}
      />

      {state.error && <ErrorMessage error={state.error} />}

      <button
        type="submit"
        disabled={isPending || !consentOk}
        className="rounded-md bg-[#10B981] px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371] disabled:opacity-60"
      >
        {isPending ? t('signin_submitting') : t('signin_submit')}
      </button>
    </form>
  );
}

function ErrorMessage({ error }: { error: NonNullable<AcceptInvitationState['error']> }) {
  const t = useTranslations('invite');
  const key =
    {
      not_found: 'error_not_found',
      expired: 'error_expired',
      already_accepted: 'error_already_accepted',
      wrong_email: 'error_wrong_email',
      invalid_input: 'error_invalid_input',
      full_name_too_short: 'error_full_name_too_short',
      full_name_too_long: 'error_full_name_too_long',
      date_of_birth_invalid: 'error_date_of_birth_invalid',
      password_too_short: 'error_password_too_short',
      password_mismatch: 'error_password_mismatch',
      no_session: 'error_no_session',
      wrong_credentials: 'error_wrong_credentials',
      auth_update_failed: 'error_auth_update_failed',
      profile_update_failed: 'error_profile_update_failed',
      membership_failed: 'error_membership_failed',
      player_link_failed: 'error_player_link_failed',
      team_staff_failed: 'error_team_staff_failed',
      consent_required: 'error_consent_required',
      generic: 'error_generic',
    }[error] ?? 'error_generic';

  return (
    <p role="alert" className="text-sm text-red-400">
      {t(key)}
    </p>
  );
}
