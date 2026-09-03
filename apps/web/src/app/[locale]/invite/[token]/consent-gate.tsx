'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LegalTextModal } from '@/components/legal/legal-text-modal';
import type { AccountConsentDoc } from './consent-data';
import { fieldIds, type FormProblem } from './validation';

export type ConsentGateProps = {
  terms: AccountConsentDoc | null;
  privacy: AccountConsentDoc | null;
  /** Ya aceptados en versión vigente (flujo con sesión) → casilla satisfecha. */
  preAcceptedTerms: boolean;
  preAcceptedPrivacy: boolean;
  /** Problema del último intento de envío, si falta marcar alguna de las dos. */
  problem?: FormProblem | undefined;
};

/**
 * F14-2 — casillas OBLIGATORIAS de T&C + Privacidad en el paso final del alta.
 * Cada casilla enlaza al texto vigente (modal). Si ya se aceptó la versión
 * vigente, se muestra satisfecha (sin casilla) y no se envía flag. Los flags
 * `accept_terms`/`accept_privacy` viajan en el form; el servidor los revalida.
 *
 * Ya NO gatea el botón: si falta marcarlas, el validador del formulario lo dice
 * y aquí se pinta la marca. Eran, además, los ÚNICOS campos que ni siquiera
 * tenían validación nativa del navegador detrás.
 */
export function ConsentGate({
  terms,
  privacy,
  preAcceptedTerms,
  preAcceptedPrivacy,
  problem,
}: ConsentGateProps) {
  const t = useTranslations('invite');
  const [checkedTerms, setCheckedTerms] = useState(false);
  const [checkedPrivacy, setCheckedPrivacy] = useState(false);
  const [openDoc, setOpenDoc] = useState<AccountConsentDoc | null>(null);

  const row = (
    doc: AccountConsentDoc | null,
    preAccepted: boolean,
    checked: boolean,
    setChecked: (v: boolean) => void,
    fieldName: string,
    fieldId: string,
    acceptLabel: string,
  ) => {
    if (doc == null) return null;
    if (preAccepted) {
      return (
        <p className="flex items-center gap-2 text-left text-sm text-zinc-400">
          <span aria-hidden className="text-[#10B981]">
            ✓
          </span>
          <span>{t('consent_already', { doc: doc.title })}</span>
        </p>
      );
    }
    return (
      <label className="flex items-start gap-2 text-left text-sm text-zinc-200">
        <input
          type="checkbox"
          id={fieldId}
          name={fieldName}
          value="true"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          aria-invalid={problem != null && !checked}
          className="mt-0.5 size-4 shrink-0 accent-[#10B981]"
        />
        <span>
          {acceptLabel}{' '}
          <button
            type="button"
            onClick={() => setOpenDoc(doc)}
            className="underline underline-offset-2 hover:text-[#10B981]"
          >
            ({t('consent_view')})
          </button>
        </span>
      </label>
    );
  };

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
      <p className="text-left text-xs font-medium text-zinc-400">{t('consent_intro')}</p>
      {row(
        terms,
        preAcceptedTerms,
        checkedTerms,
        setCheckedTerms,
        'accept_terms',
        fieldIds.terms,
        t('consent_accept_terms'),
      )}
      {row(
        privacy,
        preAcceptedPrivacy,
        checkedPrivacy,
        setCheckedPrivacy,
        'accept_privacy',
        fieldIds.privacy,
        t('consent_accept_privacy'),
      )}

      {problem && (
        <p className="text-left text-xs text-red-400">{t(problem.messageKey)}</p>
      )}

      <LegalTextModal
        open={openDoc != null}
        title={openDoc?.title ?? null}
        body={openDoc?.body ?? null}
        closeLabel={t('consent_close')}
        errorLabel={t('consent_close')}
        onClose={() => setOpenDoc(null)}
      />
    </div>
  );
}
