'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck } from 'lucide-react';
import { submitReconsent, type ReconsentState } from './actions';

export type LegalText = { title: string; body: string } | null;
export type ReconsentChild = { id: string; name: string };

type Props = {
  locale: string;
  seasonLabel: string;
  /**
   * F14-14 — TRUE si algún OBLIGATORIO está pendiente: la pantalla bloquea (no hay
   * salida sin firmar). FALSE = solo opcionales pendientes: se presenta pero el
   * tutor puede salir sin firmar.
   */
  blocking: boolean;
  terms: LegalText;
  privacy: LegalText;
  internalDoc: LegalText;
  socialDoc: LegalText;
  medicalDoc: LegalText;
  players: ReconsentChild[];
};

/**
 * F14-5/14 — Pantalla de RE-CONSENTIMIENTO. Solo pinta los doc_types PENDIENTES
 * (re-firma selectiva): un doc que no cambió no aparece. Arriba los OBLIGATORIOS
 * (T&C + Privacidad) pendientes, que deben marcarse para continuar; debajo, por
 * cada hijo, los OPCIONALES pendientes (imagen interna, imagen redes, médico) con
 * decisión sí/no o "sin cambios". Si solo hay opcionales (`blocking=false`) se
 * ofrece una salida "continuar" para que el tutor no quede atrapado.
 */
export function ReconsentForm({
  locale,
  seasonLabel,
  blocking,
  terms,
  privacy,
  internalDoc,
  socialDoc,
  medicalDoc,
  players,
}: Props) {
  const t = useTranslations('reconsent');
  const [state, formAction, pending] = useActionState<ReconsentState, FormData>(
    submitReconsent,
    {},
  );
  const [checkedTerms, setCheckedTerms] = useState(false);
  const [checkedPrivacy, setCheckedPrivacy] = useState(false);
  const [openDoc, setOpenDoc] = useState<{ title: string; body: string } | null>(null);

  const hasRequired = terms != null || privacy != null;
  const hasOptional = internalDoc != null || socialDoc != null || medicalDoc != null;
  const termsOk = terms == null || checkedTerms;
  const privacyOk = privacy == null || checkedPrivacy;
  const canSubmit = termsOk && privacyOk && !pending;

  return (
    <form
      action={formAction}
      className="mx-auto flex w-full max-w-lg flex-col gap-5 rounded-xl border border-zinc-800 bg-[#0F1B2E] p-6 text-left"
    >
      <input type="hidden" name="locale" value={locale} />

      <div className="flex items-center gap-3">
        <ShieldCheck className="size-7 text-misterfc-green" aria-hidden />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{t('title')}</h1>
          <p className="text-sm text-zinc-400">{t('subtitle', { season: seasonLabel })}</p>
        </div>
      </div>

      {/* ── Obligatorios (solo los pendientes) ───────────────────────────── */}
      {hasRequired && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
          <p className="text-xs font-medium text-zinc-400">{t('required_intro')}</p>
          <ConsentCheck
            doc={terms}
            checked={checkedTerms}
            setChecked={setCheckedTerms}
            name="accept_terms"
            label={t('accept_terms')}
            onView={setOpenDoc}
            viewLabel={t('view')}
          />
          <ConsentCheck
            doc={privacy}
            checked={checkedPrivacy}
            setChecked={setCheckedPrivacy}
            name="accept_privacy"
            label={t('accept_privacy')}
            onView={setOpenDoc}
            viewLabel={t('view')}
          />
        </div>
      )}

      {/* ── Opcionales por hijo (solo los pendientes) ────────────────────── */}
      {players.length > 0 && hasOptional && (
        <div className="flex flex-col gap-4">
          <p className="text-xs font-medium text-zinc-400">{t('optional_intro')}</p>
          {players.map((child) => (
            <div
              key={child.id}
              className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/30 p-3"
            >
              <p className="text-sm font-semibold text-white">{child.name}</p>
              <TriState
                pid={child.id}
                field="internal"
                doc={internalDoc}
                label={t('image_internal')}
                onView={setOpenDoc}
                viewLabel={t('view')}
                keepLabel={t('keep')}
                yesLabel={t('yes')}
                noLabel={t('no')}
              />
              <TriState
                pid={child.id}
                field="social"
                doc={socialDoc}
                label={t('image_social')}
                onView={setOpenDoc}
                viewLabel={t('view')}
                keepLabel={t('keep')}
                yesLabel={t('yes')}
                noLabel={t('no')}
              />
              <TriState
                pid={child.id}
                field="medical"
                doc={medicalDoc}
                label={t('medical')}
                onView={setOpenDoc}
                viewLabel={t('view')}
                keepLabel={t('keep')}
                yesLabel={t('yes')}
                noLabel={t('no')}
              />
            </div>
          ))}
        </div>
      )}

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-misterfc-green px-4 py-2.5 text-sm font-semibold text-zinc-900 transition enabled:hover:bg-[#0EA371] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        <span>{t('continue')}</span>
      </button>

      {/* F14-14 — solo opcionales pendientes: no bloquea, el tutor puede salir. */}
      {!blocking && (
        <Link
          href={`/${locale}`}
          className="text-center text-sm text-zinc-400 underline underline-offset-2 hover:text-misterfc-green"
        >
          {t('skip')}
        </Link>
      )}

      {openDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenDoc(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-lg border border-zinc-700 bg-[#0F1B2E] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">{openDoc.title}</h2>
            <div className="overflow-y-auto whitespace-pre-wrap text-sm text-zinc-300">
              {openDoc.body}
            </div>
            <button
              type="button"
              onClick={() => setOpenDoc(null)}
              className="self-end rounded-md bg-misterfc-green px-3 py-1.5 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371]"
            >
              {t('close')}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function ConsentCheck({
  doc,
  checked,
  setChecked,
  name,
  label,
  onView,
  viewLabel,
}: {
  doc: LegalText;
  checked: boolean;
  setChecked: (v: boolean) => void;
  name: string;
  label: string;
  onView: (d: { title: string; body: string }) => void;
  viewLabel: string;
}) {
  if (doc == null) return null;
  return (
    <label className="flex items-start gap-2 text-sm text-zinc-200">
      <input
        type="checkbox"
        name={name}
        value="true"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-misterfc-green"
      />
      <span>
        {label}{' '}
        <button
          type="button"
          onClick={() => onView(doc)}
          className="underline underline-offset-2 hover:text-misterfc-green"
        >
          ({viewLabel})
        </button>
      </span>
    </label>
  );
}

function TriState({
  pid,
  field,
  doc,
  label,
  onView,
  viewLabel,
  keepLabel,
  yesLabel,
  noLabel,
}: {
  pid: string;
  field: 'internal' | 'social' | 'medical';
  doc: LegalText;
  label: string;
  onView: (d: { title: string; body: string }) => void;
  viewLabel: string;
  keepLabel: string;
  yesLabel: string;
  noLabel: string;
}) {
  // F14-14 — si el doc no está pendiente para este tipo, no se ofrece.
  if (doc == null) return null;
  const name = `reconsent_${field}_${pid}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm text-zinc-200">
        <span>{label}</span>
        {doc && (
          <button
            type="button"
            onClick={() => onView(doc)}
            className="text-xs underline underline-offset-2 text-zinc-400 hover:text-misterfc-green"
          >
            ({viewLabel})
          </button>
        )}
      </div>
      <div className="flex gap-3 text-sm text-zinc-300">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} value="unset" defaultChecked className="accent-zinc-500" />
          <span>{keepLabel}</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} value="yes" className="accent-misterfc-green" />
          <span>{yesLabel}</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} value="no" className="accent-misterfc-green" />
          <span>{noLabel}</span>
        </label>
      </div>
    </div>
  );
}
