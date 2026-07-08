'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AccountConsentDoc } from './consent-data';

export type ConsentGateProps = {
  terms: AccountConsentDoc | null;
  privacy: AccountConsentDoc | null;
  /** Ya aceptados en versión vigente (flujo con sesión) → casilla satisfecha. */
  preAcceptedTerms: boolean;
  preAcceptedPrivacy: boolean;
  /** Notifica al form si AMBOS obligatorios están satisfechos (para gatear el botón). */
  onSatisfiedChange: (ok: boolean) => void;
};

/**
 * F14-2 — casillas OBLIGATORIAS de T&C + Privacidad en el paso final del alta.
 * Cada casilla enlaza al texto vigente (modal). Si ya se aceptó la versión
 * vigente, se muestra satisfecha (sin casilla) y no se envía flag. Los flags
 * `accept_terms`/`accept_privacy` viajan en el form; el servidor los revalida.
 */
export function ConsentGate({
  terms,
  privacy,
  preAcceptedTerms,
  preAcceptedPrivacy,
  onSatisfiedChange,
}: ConsentGateProps) {
  const t = useTranslations('invite');
  const [checkedTerms, setCheckedTerms] = useState(false);
  const [checkedPrivacy, setCheckedPrivacy] = useState(false);
  const [openDoc, setOpenDoc] = useState<AccountConsentDoc | null>(null);

  // Un doc ausente en BD (no debería) no puede bloquear el alta → satisfecho.
  const termsOk = terms == null || preAcceptedTerms || checkedTerms;
  const privacyOk = privacy == null || preAcceptedPrivacy || checkedPrivacy;
  const satisfied = termsOk && privacyOk;

  useEffect(() => {
    onSatisfiedChange(satisfied);
  }, [satisfied, onSatisfiedChange]);

  const row = (
    doc: AccountConsentDoc | null,
    preAccepted: boolean,
    checked: boolean,
    setChecked: (v: boolean) => void,
    fieldName: string,
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
          name={fieldName}
          value="true"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
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
        t('consent_accept_terms'),
      )}
      {row(
        privacy,
        preAcceptedPrivacy,
        checkedPrivacy,
        setCheckedPrivacy,
        'accept_privacy',
        t('consent_accept_privacy'),
      )}

      {openDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenDoc(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-lg border border-zinc-700 bg-[#0F1B2E] p-5 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">{openDoc.title}</h2>
            <div className="overflow-y-auto whitespace-pre-wrap text-sm text-zinc-300">
              {openDoc.body}
            </div>
            <button
              type="button"
              onClick={() => setOpenDoc(null)}
              className="self-end rounded-md bg-[#10B981] px-3 py-1.5 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371]"
            >
              {t('consent_close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
