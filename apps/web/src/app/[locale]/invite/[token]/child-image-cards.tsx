'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  PLAYER_PHOTO_MAX_BYTES,
  PLAYER_PHOTO_MIME_TYPES,
  playerPhotoUploadSchema,
} from '@misterfc/core';
import { LegalTextModal } from '@/components/legal/legal-text-modal';
import type { ImageConsentDoc, MedicalConsentDoc } from './consent-data';
import { fieldIds, type FormProblem } from './validation';

/** F14-3c — un hijo pendiente con su player_id (para nombrar los campos del form). */
export type PendingChild = {
  playerId: string | null;
  playerName: string | null;
  // Rework C/D — datos editables del hijo para el paso de confirmación.
  playerFirstName: string | null;
  playerLastName: string | null;
  playerDob: string | null;
  teamName: string | null;
};

type Decision = 'yes' | 'no' | null;
type ChildState = {
  internal: Decision;
  social: Decision;
  preview: string | null;
  fileError: string | null;
  // F14-4 — consentimiento médico (opcional, no gatea el alta).
  medical: Decision;
};

function emptyState(): ChildState {
  return {
    internal: null,
    social: null,
    preview: null,
    fileError: null,
    medical: null,
  };
}

type LegalText = { title: string; body: string };

type Props = {
  items: PendingChild[];
  imageInternal: ImageConsentDoc | null;
  imageSocial: ImageConsentDoc | null;
  medicalDoc: MedicalConsentDoc | null;
  /** Problemas del último intento de envío, para marcar los campos que faltan. */
  problems: FormProblem[];
};

/**
 * F14-3c — Tarjeta por hijo con dos decisiones de imagen INDEPENDIENTES (interna
 * / redes, sí/no explícito, no casilla muda) + selector de imagen OBLIGATORIO.
 * Los inputs con `name` viajan en el FormData del alta; el estado local solo
 * gobierna el preview y el error de formato del fichero.
 *
 * Ya NO gatea el botón: lo que falte lo dice el validador del formulario, que
 * lee el FormData y nombra al hijo. Aquí solo se pinta la marca de cada campo.
 */
export function ChildrenImageSection({
  items,
  imageInternal,
  imageSocial,
  medicalDoc,
  problems,
}: Props) {
  const t = useTranslations('invite');
  const kids = items.filter(
    (c): c is PendingChild & { playerId: string } => c.playerId != null
  );
  const [states, setStates] = useState<Record<string, ChildState>>(() =>
    Object.fromEntries(kids.map((c) => [c.playerId, emptyState()]))
  );
  const [viewer, setViewer] = useState<LegalText | null>(null);

  function patch(pid: string, p: Partial<ChildState>) {
    setStates((prev) => ({ ...prev, [pid]: { ...prev[pid]!, ...p } }));
  }

  const problemFor = (fieldId: string) => problems.find((p) => p.fieldId === fieldId);

  function mapFileError(code: string | undefined): string {
    if (code === 'player_photo_mime_invalid') return t('image_err_mime');
    if (code === 'player_photo_too_large') return t('image_err_large');
    if (code === 'player_photo_empty') return t('image_err_empty');
    return t('image_err_generic');
  }

  function onFile(pid: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      patch(pid, { preview: null, fileError: null });
      return;
    }
    const v = playerPhotoUploadSchema.safeParse({ mimeType: file.type, size: file.size });
    if (!v.success) {
      // Fichero inválido: lo descartamos del form (no debe enviarse).
      e.target.value = '';
      patch(pid, { preview: null, fileError: mapFileError(v.error.issues[0]?.message) });
      return;
    }
    patch(pid, { preview: URL.createObjectURL(file), fileError: null });
  }

  if (kids.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-xs font-medium text-zinc-300">{t('image_heading')}</p>

      {kids.map((c) => {
        const s = states[c.playerId]!;
        const maxMb = String(PLAYER_PHOTO_MAX_BYTES / 1024 / 1024);
        return (
          <div
            key={c.playerId}
            className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-left"
          >
            <p className="text-sm font-semibold text-white">
              {c.playerName ?? t('child_unnamed')}
              <span className="text-zinc-500">
                {' · '}
                {c.teamName ?? t('child_no_team')}
              </span>
            </p>

            <ImageDecision
              legendKey="image_internal_q"
              id={fieldIds.imageInternal(c.playerId)}
              name={`image_internal_${c.playerId}`}
              value={s.internal}
              onChange={(d) =>
                // Cambiar a NO retira el campo: se limpia también su estado, para
                // no dejar un preview colgando de un fichero que ya no se envía.
                patch(c.playerId, d === 'no'
                  ? { internal: d, preview: null, fileError: null }
                  : { internal: d })
              }
              onView={imageInternal ? () => setViewer(imageInternal) : null}
              problem={problemFor(fieldIds.imageInternal(c.playerId))}
            />

            <ImageDecision
              legendKey="image_social_q"
              id={fieldIds.imageSocial(c.playerId)}
              name={`image_social_${c.playerId}`}
              value={s.social}
              onChange={(d) => patch(c.playerId, { social: d })}
              onView={imageSocial ? () => setViewer(imageSocial) : null}
              problem={problemFor(fieldIds.imageSocial(c.playerId))}
            />

            {/* La foto es OPCIONAL, y si la familia dice NO a la imagen interna no
                se pide siquiera: guardarla sería retener la imagen de un menor
                que la RLS (player_photo_visible) hace invisible para siempre. */}
            {s.internal !== 'no' && (
              <label className="flex flex-col gap-2 text-left">
                <span className="text-sm font-medium text-zinc-200">
                  {t('image_upload_photo')}{' '}
                  <span className="font-normal text-zinc-500">{t('optional')}</span>
                </span>
                <input
                  type="file"
                  name={`image_file_${c.playerId}`}
                  accept={PLAYER_PHOTO_MIME_TYPES.join(',')}
                  onChange={(e) => onFile(c.playerId, e)}
                  className="text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-sm file:text-white"
                />
                <span className="text-xs text-zinc-500">{t('image_hint', { maxMb })}</span>
                {s.preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.preview} alt="" className="size-16 rounded-md object-cover" />
                )}
                {s.fileError && <span className="text-xs text-red-400">{s.fileError}</span>}
              </label>
            )}

            {/* F14-4 — Consentimiento informado de datos médicos (OPCIONAL). */}
            <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
              <ImageDecision
                legendKey="medical_q"
                name={`medical_consent_${c.playerId}`}
                value={s.medical}
                onChange={(d) => patch(c.playerId, { medical: d })}
                onView={medicalDoc ? () => setViewer(medicalDoc) : null}
                required={false}
              />
              {s.medical === 'yes' && (
                <div className="flex flex-col gap-2">
                  <MedicalField name={`med_allergies_${c.playerId}`} labelKey="medical_allergies" />
                  <MedicalField
                    name={`med_medication_${c.playerId}`}
                    labelKey="medical_medication"
                  />
                  <MedicalField
                    name={`med_conditions_${c.playerId}`}
                    labelKey="medical_conditions"
                  />
                  <MedicalField
                    name={`med_emergency_${c.playerId}`}
                    labelKey="medical_emergency"
                  />
                  <span className="text-xs text-zinc-500">{t('medical_optional_hint')}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <LegalTextModal
        open={viewer != null}
        title={viewer?.title ?? null}
        body={viewer?.body ?? null}
        closeLabel={t('consent_close')}
        errorLabel={t('consent_close')}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}

function ImageDecision({
  legendKey,
  id,
  name,
  value,
  onChange,
  onView,
  required = true,
  problem,
}: {
  legendKey: string;
  /** Va en el radio "sí": es el que recibe el foco cuando falta la respuesta. */
  id?: string;
  name: string;
  value: Decision;
  onChange: (d: Decision) => void;
  onView: (() => void) | null;
  required?: boolean;
  problem?: FormProblem | undefined;
}) {
  const t = useTranslations('invite');
  // `aria-invalid` no aplica al rol radio; el grupo se describe con su aviso.
  const errorId = id ? `${id}-error` : undefined;
  return (
    <fieldset
      className="flex flex-col gap-1"
      aria-describedby={problem && errorId ? errorId : undefined}
    >
      <legend className={problem ? 'text-sm text-red-300' : 'text-sm text-zinc-200'}>
        {t(legendKey)}
        {onView && (
          <button
            type="button"
            onClick={onView}
            className="ml-2 text-xs text-[#10B981] underline"
          >
            {t('consent_view')}
          </button>
        )}
      </legend>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm text-zinc-200">
          <input
            type="radio"
            id={id}
            name={name}
            value="yes"
            required={required}
            checked={value === 'yes'}
            onChange={() => onChange('yes')}
          />
          {t('image_yes')}
        </label>
        <label className="flex items-center gap-1.5 text-sm text-zinc-200">
          <input
            type="radio"
            name={name}
            value="no"
            checked={value === 'no'}
            onChange={() => onChange('no')}
          />
          {t('image_no')}
        </label>
      </div>
      {problem && (
        <span id={errorId} className="text-xs text-red-400">
          {t(problem.messageKey)}
        </span>
      )}
    </fieldset>
  );
}

/** F14-4 — un campo médico estructurado (texto), opcional. */
function MedicalField({ name, labelKey }: { name: string; labelKey: string }) {
  const t = useTranslations('invite');
  return (
    <label className="flex flex-col gap-1 text-left">
      <span className="text-xs font-medium text-zinc-300">{t(labelKey)}</span>
      <textarea
        name={name}
        rows={2}
        maxLength={2000}
        className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-white outline-none transition focus:border-[#10B981]"
      />
    </label>
  );
}
