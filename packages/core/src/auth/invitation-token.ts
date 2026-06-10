/**
 * Validación pura del token de invitación (Rework B · B2).
 *
 * El token de `invitations` es la credencial del flujo /invite/{token}: la
 * acción de aceptar lo valida server-side y, si es válido, fija contraseña /
 * crea sesión / adjunta al club. Centralizamos aquí los chequeos *puros* (no
 * dependen de Supabase ni de Next) para poder testarlos en aislamiento y para
 * que page + actions compartan exactamente el mismo gate.
 *
 * NO incluye el chequeo de sesión: en B2 el accept no requiere sesión previa.
 */

export type InvitationVerdict =
  | 'valid'
  | 'not_found'
  | 'already_accepted'
  | 'expired'
  | 'wrong_email';

/** Forma mínima de la fila de invitación que necesita el verdict. */
export type InvitationGateRow = {
  accepted_at: string | null;
  expires_at: string;
  email: string;
} | null;

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Decide el estado de una invitación cargada por token.
 *
 * @param row        Fila de `invitations` (o null si no existe el token).
 * @param nowMs      Reloj inyectado (Date.now()) para tests deterministas.
 * @param authedEmail  Email del usuario autenticado, si lo hay. Cuando se pasa,
 *                     se exige coincidencia con el email de la invitación
 *                     (case-insensitive). Cuando es undefined/null se omite el
 *                     chequeo de email (caso B2: el invitee aún no tiene sesión).
 */
export function assertInvitationValid(
  row: InvitationGateRow,
  nowMs: number,
  authedEmail?: string | null
): InvitationVerdict {
  if (!row) return 'not_found';
  if (row.accepted_at) return 'already_accepted';

  const expiresMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresMs) || expiresMs < nowMs) return 'expired';

  if (authedEmail !== undefined && authedEmail !== null) {
    if (normalizeEmail(authedEmail) !== normalizeEmail(row.email)) {
      return 'wrong_email';
    }
  }

  return 'valid';
}
