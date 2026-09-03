import {
  findAcceptProblems,
  type AcceptChild,
  type AcceptFormRules,
  type AcceptProblem,
  type AcceptProblemCode,
} from '@misterfc/core';

/**
 * La cara visible del validador del formulario de aceptar invitación.
 *
 * La DECISIÓN de qué falta vive en core (`findAcceptProblems`, con tests). Aquí
 * solo está lo que es de la interfaz: a qué control lleva cada problema y qué
 * texto le corresponde. El formulario lleva `noValidate`, así que este es el
 * único mecanismo de aviso: antes había dos (burbujas nativas para unos campos,
 * nada para otros) y el botón deshabilitado impedía que se viera ninguno.
 */

export type { AcceptFormRules, AcceptChild };

/** Ids de los controles. Los pintan los componentes y aquí se apunta a ellos. */
export const fieldIds = {
  fullName: 'invite-full-name',
  dateOfBirth: 'invite-date-of-birth',
  password: 'invite-password',
  confirm: 'invite-confirm',
  terms: 'invite-accept-terms',
  privacy: 'invite-accept-privacy',
  childFirstName: (pid: string) => `invite-child-first-${pid}`,
  childDob: (pid: string) => `invite-child-dob-${pid}`,
  imageInternal: (pid: string) => `invite-image-internal-${pid}`,
  imageSocial: (pid: string) => `invite-image-social-${pid}`,
  imageFile: (pid: string) => `invite-image-file-${pid}`,
} as const;

/**
 * Un problema listo para pintar: dónde llevar el foco y qué decir.
 *
 * `messageKey` reutiliza las claves que ya existían para los avisos del tutor y
 * de la cuenta (estaban escritas en los tres idiomas y no las veía nadie). Las
 * de hijo son nuevas porque las viejas decían "de algún hijo", que es justo la
 * vaguedad que hay que quitar: ahora la línea la encabeza el nombre del hijo.
 */
export type FormProblem = {
  messageKey: string;
  fieldId: string;
  childName?: string;
};

const MESSAGE_KEY: Record<AcceptProblemCode, string> = {
  full_name_too_short: 'error_full_name_too_short',
  full_name_too_long: 'error_full_name_too_long',
  date_of_birth_invalid: 'error_date_of_birth_invalid',
  child_name_required: 'missing_child_name',
  child_dob_invalid: 'missing_child_dob',
  image_internal_missing: 'missing_image_internal',
  image_social_missing: 'missing_image_social',
  photo_missing: 'missing_photo',
  password_too_short: 'error_password_too_short',
  password_mismatch: 'error_password_mismatch',
  password_missing: 'missing_password',
  consent_required: 'error_consent_required',
};

function fieldIdFor(
  problem: AcceptProblem,
  rules: AcceptFormRules,
  formData: FormData,
): string {
  const pid = problem.playerId ?? '';
  switch (problem.code) {
    case 'full_name_too_short':
    case 'full_name_too_long':
      return fieldIds.fullName;
    case 'date_of_birth_invalid':
      return fieldIds.dateOfBirth;
    case 'child_name_required':
      return fieldIds.childFirstName(pid);
    case 'child_dob_invalid':
      return fieldIds.childDob(pid);
    case 'image_internal_missing':
      return fieldIds.imageInternal(pid);
    case 'image_social_missing':
      return fieldIds.imageSocial(pid);
    case 'photo_missing':
      return fieldIds.imageFile(pid);
    case 'password_too_short':
    case 'password_missing':
      return fieldIds.password;
    case 'password_mismatch':
      return fieldIds.confirm;
    case 'consent_required': {
      // Lleva a la casilla que de verdad falte; si faltan las dos, a la primera.
      const termsMissing = rules.requireTerms && formData.get('accept_terms') !== 'true';
      return termsMissing ? fieldIds.terms : fieldIds.privacy;
    }
  }
}

/** Los problemas del formulario, listos para pintar. */
export function collectFormProblems(
  formData: FormData,
  rules: AcceptFormRules,
): FormProblem[] {
  return findAcceptProblems(formData, rules).map((p) => {
    const child = p.playerId
      ? rules.children.find((c) => c.playerId === p.playerId)
      : undefined;
    return {
      messageKey: MESSAGE_KEY[p.code],
      fieldId: fieldIdFor(p, rules, formData),
      ...(child ? { childName: child.name } : {}),
    };
  });
}
