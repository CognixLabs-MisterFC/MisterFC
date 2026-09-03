import { acceptInvitationWithProfileSchema } from '../schemas/auth';
import { playerPhotoUploadSchema } from '../schemas/player';

/**
 * Qué le falta al formulario de aceptar invitación.
 *
 * Vive en core, y no en la web, por una razón: es la lógica que decide si un
 * padre puede completar el alta, y aquí es donde el CI ejecuta tests. El
 * formulario no tenía ninguno.
 *
 * NO INVENTA REGLAS. Las del perfil salen de `acceptInvitationWithProfileSchema`
 * y las de la foto de `playerPhotoUploadSchema` — los mismos schemas que corre
 * el servidor al aceptar. Las del hijo (`validateChildRow`) las importa también
 * la Server Action, así que hay UNA copia de cada una.
 *
 * Devuelve códigos, no textos ni ids de campo: de eso se encarga quien pinta.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Datos del hijo confirmados por el tutor — compartido con la Server Action
// ─────────────────────────────────────────────────────────────────────────────

export const CHILD_FIRST_NAME_MAX = 80;
export const CHILD_LAST_NAME_MAX = 120;

/**
 * Fecha de nacimiento del hijo. Mismo criterio que el alta (yyyy-mm-dd,
 * >= 1900, no futura).
 */
export function isValidChildDob(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  if (year < 1900) return false;
  if (d.getTime() > Date.now()) return false;
  return true;
}

export type ChildRowError = 'child_name_required' | 'child_dob_invalid';

/** Valida una fila de datos de hijo. Mismo orden de comprobaciones que el server. */
export function validateChildRow(row: {
  firstName: string;
  lastName: string;
  dob: string;
}): ChildRowError | null {
  const first = row.firstName.trim();
  const last = row.lastName.trim();
  const dob = row.dob.trim();
  if (first.length === 0 || first.length > CHILD_FIRST_NAME_MAX) return 'child_name_required';
  if (last.length > CHILD_LAST_NAME_MAX) return 'child_name_required';
  if (!isValidChildDob(dob)) return 'child_dob_invalid';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// El validador del formulario
// ─────────────────────────────────────────────────────────────────────────────

export type AcceptProblemCode =
  | 'full_name_too_short'
  | 'full_name_too_long'
  | 'date_of_birth_invalid'
  | 'child_name_required'
  | 'child_dob_invalid'
  | 'image_internal_missing'
  | 'image_social_missing'
  | 'photo_missing'
  | 'password_too_short'
  | 'password_mismatch'
  | 'password_missing'
  | 'consent_required';

export type AcceptProblem = {
  code: AcceptProblemCode;
  /** Hijo al que pertenece el problema. Ausente si es del tutor o de la cuenta. */
  playerId?: string;
};

export type AcceptChild = { playerId: string; name: string };

export type AcceptFormRules = {
  /** Casilla de T&C pendiente (hay documento vigente y no está pre-aceptado). */
  requireTerms: boolean;
  /** Casilla de privacidad pendiente. */
  requirePrivacy: boolean;
  /** Hijos del lote, con sus dos decisiones de imagen. */
  children: AcceptChild[];
  /** El flujo pide confirmar nombre + fecha de nacimiento de cada hijo. */
  requireChildData: boolean;
  /** El flujo pide nombre del tutor + contraseña nueva + confirmación. */
  requireProfile: boolean;
  /** El flujo pide la contraseña que el usuario ya tenía. */
  requireOwnPassword: boolean;
  /**
   * La foto de cada hijo es obligatoria. Hoy sí: la exigen la Server Action y la
   * RPC. Deja de serlo cuando se aplique la migración que la hace opcional.
   */
  requirePhoto: boolean;
};

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

/**
 * Todos los problemas del formulario, en el orden en que están pintados los
 * campos (perfil → hijos → imagen → contraseña → consentimientos), que es el
 * mismo en los tres flujos. Así la lista se lee de arriba abajo como la página.
 */
export function findAcceptProblems(formData: FormData, rules: AcceptFormRules): AcceptProblem[] {
  const problems: AcceptProblem[] = [];

  // 1 · Datos del tutor. Se evalúa aquí una vez, pero la contraseña se avisa en
  // el punto 4: en la página va DESPUÉS de los hijos.
  const profileIssues = rules.requireProfile
    ? (acceptInvitationWithProfileSchema.safeParse({
        full_name: str(formData, 'full_name'),
        date_of_birth: str(formData, 'date_of_birth'),
        password: str(formData, 'password'),
        confirm: str(formData, 'confirm'),
      }).error?.issues ?? [])
    : [];

  for (const issue of profileIssues) {
    const field = String(issue.path[0] ?? '');
    if (field === 'full_name') {
      problems.push({
        code: issue.message === 'full_name_too_long' ? 'full_name_too_long' : 'full_name_too_short',
      });
    } else if (field === 'date_of_birth') {
      problems.push({ code: 'date_of_birth_invalid' });
    }
  }

  // 2 · Datos de cada hijo (nombre + fecha de nacimiento).
  if (rules.requireChildData) {
    for (const row of parseChildrenData(str(formData, 'children_data'))) {
      if (!rules.children.some((c) => c.playerId === row.playerId)) continue;
      const verdict = validateChildRow(row);
      if (verdict) problems.push({ code: verdict, playerId: row.playerId });
    }
  }

  // 3 · Decisiones de imagen (OBLIGATORIAS: son el consentimiento) y foto.
  for (const child of rules.children) {
    const pid = child.playerId;

    const internal = str(formData, `image_internal_${pid}`);
    if (internal !== 'yes' && internal !== 'no') {
      problems.push({ code: 'image_internal_missing', playerId: pid });
    }
    const social = str(formData, `image_social_${pid}`);
    if (social !== 'yes' && social !== 'no') {
      problems.push({ code: 'image_social_missing', playerId: pid });
    }

    if (rules.requirePhoto && !hasValidPhoto(formData.get(`image_file_${pid}`))) {
      problems.push({ code: 'photo_missing', playerId: pid });
    }
  }

  // 4 · Contraseña. La nueva sale del schema; de la propia solo se comprueba que
  // no esté vacía — quien la valida de verdad es el login.
  for (const issue of profileIssues) {
    const field = String(issue.path[0] ?? '');
    if (field === 'password') problems.push({ code: 'password_too_short' });
    else if (field === 'confirm') problems.push({ code: 'password_mismatch' });
  }
  if (rules.requireOwnPassword && str(formData, 'password').length === 0) {
    problems.push({ code: 'password_missing' });
  }

  // 5 · Consentimientos de cuenta. Un solo aviso: el mensaje nombra los dos.
  const termsMissing = rules.requireTerms && str(formData, 'accept_terms') !== 'true';
  const privacyMissing = rules.requirePrivacy && str(formData, 'accept_privacy') !== 'true';
  if (termsMissing || privacyMissing) problems.push({ code: 'consent_required' });

  return problems;
}

/** Filas del input oculto `children_data`. Un JSON roto no inventa problemas. */
function parseChildrenData(
  raw: string,
): { playerId: string; firstName: string; lastName: string; dob: string }[] {
  let parsed: unknown;
  try {
    parsed = raw.trim().length > 0 ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => {
    const rec = entry as Record<string, unknown>;
    return {
      playerId: String(rec?.playerId ?? ''),
      firstName: String(rec?.firstName ?? ''),
      lastName: String(rec?.lastName ?? ''),
      dob: String(rec?.dob ?? ''),
    };
  });
}

/**
 * Un fichero de imagen utilizable. Un input vacío llega como File de 0 bytes, no
 * como ausencia: por eso no basta con mirar si existe la clave.
 */
function hasValidPhoto(value: unknown): boolean {
  if (!(value instanceof File)) return false;
  if (value.size === 0) return false;
  return playerPhotoUploadSchema.safeParse({ mimeType: value.type, size: value.size }).success;
}
