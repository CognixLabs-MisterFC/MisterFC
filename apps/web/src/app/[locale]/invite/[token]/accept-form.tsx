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
import type { AccountConsentDoc, ImageConsentDoc, MedicalConsentDoc } from './consent-data';
import { ChildrenImageSection, type PendingChild } from './child-image-cards';
import {
  collectFormProblems,
  fieldIds,
  type AcceptFormRules,
  type FormProblem,
} from './validation';

export type { PendingChild };

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
  // F14-3a/3c — hijos pendientes de este email/club + docs de imagen vigentes.
  pendingChildren: PendingChild[];
  imageInternal: ImageConsentDoc | null;
  imageSocial: ImageConsentDoc | null;
  medicalDoc: MedicalConsentDoc | null;
};

/**
 * Rework C/D — paso de CONFIRMAR/CORREGIR datos de cada hijo (nombre + fecha de
 * nacimiento). Multi-hijo: una fila por hijo pendiente. Serializa el estado a un
 * input oculto `children_data` (JSON) que la action valida y guarda en players.
 */
function ChildDataSection({
  items,
  problems,
}: {
  items: PendingChild[];
  problems: FormProblem[];
}) {
  const t = useTranslations('invite');
  const children = items.filter((c) => c.playerId != null);
  const [rows, setRows] = useState(() =>
    children.map((c) => ({
      playerId: c.playerId as string,
      firstName: c.playerFirstName ?? '',
      lastName: c.playerLastName ?? '',
      dob: c.playerDob ?? '',
    })),
  );

  if (rows.length === 0) return null;

  const update = (i: number, field: 'firstName' | 'lastName' | 'dob', value: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const inputCls =
    'rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]';
  const badCls =
    'rounded-md border border-red-500/70 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]';
  const problemFor = (fieldId: string) => problems.find((p) => p.fieldId === fieldId);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/30 p-4 text-left">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">{t('child_data_title')}</h2>
        <p className="text-xs text-zinc-400">{t('child_data_help')}</p>
      </div>
      {rows.map((r, i) => (
        <div key={r.playerId} className="flex flex-col gap-2 border-t border-zinc-800 pt-3 first:border-t-0 first:pt-0">
          {children[i]?.teamName && (
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              {children[i]?.teamName}
            </span>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-300">{t('child_first_name')}</span>
            <input
              type="text"
              id={fieldIds.childFirstName(r.playerId)}
              value={r.firstName}
              required
              minLength={1}
              maxLength={80}
              aria-invalid={problemFor(fieldIds.childFirstName(r.playerId)) != null}
              onChange={(e) => update(i, 'firstName', e.target.value)}
              className={
                problemFor(fieldIds.childFirstName(r.playerId)) ? badCls : inputCls
              }
            />
            <FieldProblem problem={problemFor(fieldIds.childFirstName(r.playerId))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-300">
              {t('child_last_name')}{' '}
              <span className="font-normal text-zinc-500">{t('optional')}</span>
            </span>
            <input
              type="text"
              value={r.lastName}
              maxLength={120}
              onChange={(e) => update(i, 'lastName', e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-300">{t('child_dob')}</span>
            <input
              type="date"
              id={fieldIds.childDob(r.playerId)}
              value={r.dob}
              required
              aria-invalid={problemFor(fieldIds.childDob(r.playerId)) != null}
              onChange={(e) => update(i, 'dob', e.target.value)}
              className={problemFor(fieldIds.childDob(r.playerId)) ? badCls : inputCls}
            />
            <FieldProblem problem={problemFor(fieldIds.childDob(r.playerId))} />
          </label>
        </div>
      ))}
      <input type="hidden" name="children_data" value={JSON.stringify(rows)} />
    </section>
  );
}

/** Un aviso bajo su campo. Dice lo mismo que la línea de la lista de arriba. */
function FieldProblem({ problem }: { problem: FormProblem | undefined }) {
  const t = useTranslations('invite');
  if (!problem) return null;
  return <span className="text-xs text-red-400">{t(problem.messageKey)}</span>;
}

/** El aviso de los consentimientos de cuenta, sea cual sea de los dos el que falte. */
function consentProblem(problems: FormProblem[]): FormProblem | undefined {
  return problems.find((p) => p.fieldId === fieldIds.terms || p.fieldId === fieldIds.privacy);
}

/**
 * La lista de lo que falta, encima del botón: donde está mirando quien acaba de
 * pulsarlo. Nombra al hijo cuando el problema es de un hijo, porque con dos
 * "falta la foto" no dice nada. Cada línea lleva al campo.
 */
function MissingList({ problems }: { problems: FormProblem[] }) {
  const t = useTranslations('invite');
  if (problems.length === 0) return null;
  return (
    <div
      role="alert"
      className="w-full rounded-md border border-red-500/40 bg-red-500/10 p-3 text-left"
    >
      <p className="text-sm font-semibold text-red-300">{t('missing_heading')}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {problems.map((p) => (
          <li key={p.fieldId}>
            <button
              type="button"
              onClick={() => focusField(p.fieldId)}
              className="text-left text-sm text-red-200 underline underline-offset-2 hover:text-red-100"
            >
              {p.childName
                ? t('missing_for_child', { child: p.childName, what: t(p.messageKey) })
                : t(p.messageKey)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function focusField(fieldId: string) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

type RulesInput = {
  legalTerms: AccountConsentDoc | null;
  legalPrivacy: AccountConsentDoc | null;
  preAcceptedTerms: boolean;
  preAcceptedPrivacy: boolean;
  pendingChildren: PendingChild[];
  unnamed: string;
  requireChildData: boolean;
  requireProfile: boolean;
  requireOwnPassword: boolean;
};

/**
 * Qué exige este formulario. Un doc ausente en BD (no debería) no puede bloquear
 * el alta, igual que antes; y un consentimiento ya aceptado en versión vigente
 * no se vuelve a pedir.
 */
function acceptRules(input: RulesInput): AcceptFormRules {
  return {
    requireTerms: input.legalTerms != null && !input.preAcceptedTerms,
    requirePrivacy: input.legalPrivacy != null && !input.preAcceptedPrivacy,
    children: input.pendingChildren
      .filter((c): c is PendingChild & { playerId: string } => c.playerId != null)
      .map((c) => ({ playerId: c.playerId, name: c.playerName ?? input.unnamed })),
    requireChildData: input.requireChildData,
    requireProfile: input.requireProfile,
    requireOwnPassword: input.requireOwnPassword,
  };
}

/**
 * El envío de los tres formularios.
 *
 * La validación va DENTRO de la action de `useActionState`, no en un `onSubmit`:
 * así corre sobre el FormData exacto que se enviaría y no depende de que
 * `preventDefault` pare la action. Si algo falta, no se llama al servidor —
 * ni se suben las fotos — y el problema se pinta.
 *
 * `revalidate` recalcula la lista mientras el usuario corrige, pero solo después
 * del primer intento: nadie ve un formulario en rojo antes de pulsar. Los datos
 * del hijo van por un input oculto que React actualiza en el render siguiente,
 * así que ahí la marca desaparece una tecla más tarde.
 */
function useAcceptSubmit(
  rules: AcceptFormRules,
  run: (prev: AcceptInvitationState, formData: FormData) => Promise<AcceptInvitationState>,
) {
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const [state, formAction, isPending] = useActionState<AcceptInvitationState, FormData>(
    async (prev, formData) => {
      const found = collectFormProblems(formData, rules);
      setProblems(found);
      if (found.length > 0) {
        // El foco se mueve AQUÍ, en el intento de envío, y no en un efecto sobre
        // `problems`: si dependiera de la lista, `revalidate` se lo llevaría de
        // un campo a otro mientras el padre escribe. Los campos existen siempre,
        // así que no hay que esperar al render.
        focusField(found[0]!.fieldId);
        return {};
      }
      return run(prev, formData);
    },
    {},
  );

  const revalidate = (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    setProblems((prev) =>
      prev.length === 0 ? prev : collectFormProblems(new FormData(form), rules),
    );
  };

  return { state, formAction, isPending, problems, revalidate };
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
  imageInternal,
  imageSocial,
  medicalDoc,
}: CommonProps) {
  const t = useTranslations('invite');
  const rules = acceptRules({
    legalTerms,
    legalPrivacy,
    preAcceptedTerms,
    preAcceptedPrivacy,
    pendingChildren,
    unnamed: t('child_unnamed'),
    requireChildData: false,
    requireProfile: false,
    requireOwnPassword: false,
  });
  const { state, formAction, isPending, problems, revalidate } = useAcceptSubmit(
    rules,
    (prev, formData) => acceptInvitation(locale, token, prev, formData),
  );

  return (
    <form
      action={formAction}
      noValidate
      onChange={revalidate}
      className="flex w-full max-w-sm flex-col items-center gap-4"
    >
      <p className="text-sm text-zinc-300">{t('summary', { club: clubName, role })}</p>
      <p className="text-xs text-zinc-500">{t('invited_email_hint', { email: invitedEmail })}</p>

      <ChildrenImageSection
        items={pendingChildren}
        imageInternal={imageInternal}
        imageSocial={imageSocial}
        medicalDoc={medicalDoc}
        problems={problems}
      />

      <ConsentGate
        terms={legalTerms}
        privacy={legalPrivacy}
        preAcceptedTerms={preAcceptedTerms}
        preAcceptedPrivacy={preAcceptedPrivacy}
        problem={consentProblem(problems)}
      />

      <MissingList problems={problems} />
      {state.error && <ErrorMessage error={state.error} />}

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
  imageInternal,
  imageSocial,
  medicalDoc,
}: CommonProps) {
  const t = useTranslations('invite');
  const rules = acceptRules({
    legalTerms,
    legalPrivacy,
    preAcceptedTerms,
    preAcceptedPrivacy,
    pendingChildren,
    unnamed: t('child_unnamed'),
    requireChildData: true,
    requireProfile: true,
    requireOwnPassword: false,
  });
  const { state, formAction, isPending, problems, revalidate } = useAcceptSubmit(
    rules,
    (prev, formData) => acceptNewInvitee(locale, token, prev, formData),
  );
  const problemFor = (fieldId: string) => problems.find((p) => p.fieldId === fieldId);

  return (
    <form
      action={formAction}
      noValidate
      onChange={revalidate}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <p className="text-sm text-zinc-300">{t('set_password_summary', { club: clubName, role })}</p>

      {/* 1 · Datos del tutor */}
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
          id={fieldIds.fullName}
          name="full_name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          placeholder={t('full_name_placeholder')}
          aria-invalid={problemFor(fieldIds.fullName) != null}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
        <FieldProblem problem={problemFor(fieldIds.fullName)} />
      </label>

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">
          {t('date_of_birth_label')}{' '}
          <span className="text-xs font-normal text-zinc-500">{t('optional')}</span>
        </span>
        <input
          type="date"
          id={fieldIds.dateOfBirth}
          name="date_of_birth"
          autoComplete="bday"
          aria-invalid={problemFor(fieldIds.dateOfBirth) != null}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
        <FieldProblem problem={problemFor(fieldIds.dateOfBirth)} />
      </label>

      {/* 2 · Confirmar/corregir datos del hijo (multi-hijo) */}
      <ChildDataSection items={pendingChildren} problems={problems} />

      {/* 3 · Consentimientos por hijo (imagen / médico) */}
      <ChildrenImageSection
        items={pendingChildren}
        imageInternal={imageInternal}
        imageSocial={imageSocial}
        medicalDoc={medicalDoc}
        problems={problems}
      />

      {/* 4 · Contraseña */}
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('password_label')}</span>
        <input
          type="password"
          id={fieldIds.password}
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          aria-invalid={problemFor(fieldIds.password) != null}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
        <span className="text-xs text-zinc-500">{t('password_hint')}</span>
        <FieldProblem problem={problemFor(fieldIds.password)} />
      </label>

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-200">{t('confirm_label')}</span>
        <input
          type="password"
          id={fieldIds.confirm}
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          aria-invalid={problemFor(fieldIds.confirm) != null}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
        <FieldProblem problem={problemFor(fieldIds.confirm)} />
      </label>

      <ConsentGate
        terms={legalTerms}
        privacy={legalPrivacy}
        preAcceptedTerms={preAcceptedTerms}
        preAcceptedPrivacy={preAcceptedPrivacy}
        problem={consentProblem(problems)}
      />

      <MissingList problems={problems} />
      {state.error && <ErrorMessage error={state.error} />}

      <button
        type="submit"
        disabled={isPending}
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
  imageInternal,
  imageSocial,
  medicalDoc,
}: CommonProps) {
  const t = useTranslations('invite');
  const rules = acceptRules({
    legalTerms,
    legalPrivacy,
    preAcceptedTerms,
    preAcceptedPrivacy,
    pendingChildren,
    unnamed: t('child_unnamed'),
    requireChildData: false,
    requireProfile: false,
    requireOwnPassword: true,
  });
  const { state, formAction, isPending, problems, revalidate } = useAcceptSubmit(
    rules,
    (prev, formData) => acceptExistingUser(locale, token, prev, formData),
  );
  const problemFor = (fieldId: string) => problems.find((p) => p.fieldId === fieldId);

  return (
    <form
      action={formAction}
      noValidate
      onChange={revalidate}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <p className="text-sm text-zinc-300">{t('signin_summary', { club: clubName, role })}</p>

      <ChildrenImageSection
        items={pendingChildren}
        imageInternal={imageInternal}
        imageSocial={imageSocial}
        medicalDoc={medicalDoc}
        problems={problems}
      />

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
          id={fieldIds.password}
          name="password"
          required
          autoComplete="current-password"
          aria-invalid={problemFor(fieldIds.password) != null}
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-base text-white outline-none transition focus:border-[#10B981]"
        />
        <FieldProblem problem={problemFor(fieldIds.password)} />
      </label>

      <ConsentGate
        terms={legalTerms}
        privacy={legalPrivacy}
        preAcceptedTerms={preAcceptedTerms}
        preAcceptedPrivacy={preAcceptedPrivacy}
        problem={consentProblem(problems)}
      />

      <MissingList problems={problems} />
      {state.error && <ErrorMessage error={state.error} />}

      <button
        type="submit"
        disabled={isPending}
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
      image_required: 'error_image_required',
      image_decision_required: 'error_image_decision_required',
      child_name_required: 'error_child_name_required',
      child_dob_invalid: 'error_child_dob_invalid',
      generic: 'error_generic',
    }[error] ?? 'error_generic';

  return (
    <p role="alert" className="text-sm text-red-400">
      {t(key)}
    </p>
  );
}
