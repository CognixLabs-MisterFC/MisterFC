import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';

type DbClient = SupabaseClient<Database>;

/**
 * W-4 — NOMBRE y CONTACTO de un miembro del cuerpo técnico: quién puede tocarlos,
 * qué se acepta y cómo se escribe.
 *
 * ⚠️ ESTE PERMISO NO ES EL DE ASIGNAR. `staffAssignmentPermission` (W-2) incluye al
 * COORDINADOR; esto NO. Y no es un olvido: las dos funciones SQL lo dicen con estas
 * palabras — «Dirección del club (admin_club o director). El coordinador NO: la
 * identidad es más sensible». Así que son dos reglas distintas a propósito, y por eso
 * viven en ficheros distintos y se llaman distinto. Reutilizar aquí la de asignar le
 * daría al coordinador un botón que el RPC le niega.
 *
 * NO HAY ENDPOINT en W-4, a diferencia de W-2 y W-3. El permiso vive DENTRO de
 * `admin_update_staff_profile` y `admin_update_staff_contact`, que son SECURITY
 * DEFINER y se invocan COMO EL USUARIO: la app puede llamarlas directamente con su
 * propia sesión, sin pasar por un route handler, igual que hace
 * `removeSpectatorFromClient`. Un endpoint aquí sería una capa que no aporta gate.
 */

/**
 * ¿Puede esta persona editar el nombre y el contacto de un miembro?
 *
 * Los comentarios de las dos Server Actions de la web decían «solo admin_club», y era
 * FALSO desde la migración `20261085000000_director_edita_nombre_y_contacto`: el
 * director entró con el mismo argumento que el resto de su paridad con admin. Se
 * corrige en W-4 junto con esto.
 */
export function canEditStaffIdentity(role: Role | null | undefined): boolean {
  return role === 'admin_club' || role === 'director';
}

/**
 * ¿Puede editar el nombre y el contacto DE ESTA PERSONA?
 *
 * Es `canEditStaffIdentity` MÁS una regla que no está en ningún sitio más: **no sobre
 * uno mismo**. La web la escribía a mano en sus dos diálogos, con el motivo al lado
 * («eso va en /perfil»), y al medirlo para W-4 salió lo importante: **los dos RPC NO
 * la imponen**. `admin_update_staff_profile` y `admin_update_staff_contact` dejarían a
 * un admin editarse por esta vía sin queja.
 *
 * O sea que esto no es un gate de seguridad duplicado: es el ÚNICO sitio donde esa
 * regla existe. Por eso sube aquí en vez de reescribirse en la pantalla nativa, que
 * habría sido la tercera copia de algo que el servidor no vigila.
 *
 * Nota: la vía propia (`/perfil`) no es una limitación, es la correcta — ahí se edita
 * con `profiles_update_self` y sin pasar por un SECURITY DEFINER de administración.
 */
export function canEditStaffIdentityOf(
  viewerRole: Role | null | undefined,
  viewerProfileId: string | null | undefined,
  targetProfileId: string | null | undefined,
): boolean {
  if (!canEditStaffIdentity(viewerRole)) return false;
  // Sin saber quién mira o a quién, NO se ofrece. Falla cerrado.
  if (!viewerProfileId || !targetProfileId) return false;
  return viewerProfileId !== targetProfileId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación. Misma que el Zod de la web, aquí para que la app no la reescriba.
// Los límites no son decorativos: el SQL vuelve a comprobarlos y responde
// `name_required` / `name_too_long` / `phone_invalid` / `contact_email_invalid`.
// ─────────────────────────────────────────────────────────────────────────────

export type NameError = 'name_required' | 'name_too_long';
export type ContactError = 'phone_invalid' | 'contact_email_invalid';

/** Tope del SQL. Cambiarlo aquí sin cambiarlo allí solo mueve dónde salta el error. */
export const STAFF_NAME_MAX = 120;
const PHONE_MIN = 3;
const PHONE_MAX = 32;
const CONTACT_EMAIL_MAX = 254;
/** Mismo patrón que la web: algo@algo.algo, sin espacios ni arrobas de más. */
const CONTACT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function staffNameInput(
  raw: string,
): { ok: true; value: string } | { ok: false; error: NameError } {
  const v = raw.trim();
  if (v.length === 0) return { ok: false, error: 'name_required' };
  if (v.length > STAFF_NAME_MAX) return { ok: false, error: 'name_too_long' };
  return { ok: true, value: v };
}

/**
 * Teléfono y email de contacto, los dos OPCIONALES: vacío se guarda como `null`, no
 * como cadena vacía. Es lo que hace la web (`transform`) y lo que espera el SQL —
 * una cadena vacía dejaría un contacto que parece puesto y no lo está.
 */
export function staffContactInput(raw: {
  phone: string;
  contactEmail: string;
}):
  | { ok: true; phone: string | null; contactEmail: string | null }
  | { ok: false; error: ContactError } {
  const phone = raw.phone.trim();
  const email = raw.contactEmail.trim();

  if (phone.length > 0 && (phone.length < PHONE_MIN || phone.length > PHONE_MAX)) {
    return { ok: false, error: 'phone_invalid' };
  }
  if (email.length > 0 && (email.length > CONTACT_EMAIL_MAX || !CONTACT_EMAIL_RE.test(email))) {
    return { ok: false, error: 'contact_email_invalid' };
  }
  return {
    ok: true,
    phone: phone.length > 0 ? phone : null,
    contactEmail: email.length > 0 ? email : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrituras
// ─────────────────────────────────────────────────────────────────────────────

/** Motivos que puede dar cualquiera de las dos escrituras (lo usa la pantalla). */
export type StaffIdentityError =
  | NameError
  | ContactError
  | 'target_invalid'
  | 'forbidden'
  | 'generic';

/** Comunes a las dos: los pone el RPC, no la validación. */
type ComunError = 'target_invalid' | 'forbidden' | 'generic';

/**
 * Cada escritura devuelve SOLO sus motivos, no la unión entera.
 *
 * Al principio las dos devolvían `StaffIdentityError` y el `tsc` de la web lo cazó:
 * su estado de "editar nombre" no admite `phone_invalid`, y con razón — esa escritura
 * no puede producirlo. Una unión demasiado ancha obliga a cada llamante a manejar
 * casos imposibles, o a callarlos con un `as`.
 */
export type StaffNameError = NameError | ComunError;
export type StaffContactError = ContactError | ComunError;

export type StaffIdentityResult<E extends StaffIdentityError = StaffIdentityError> =
  | { ok: true }
  | { ok: false; error: E };

/**
 * Los RPC lanzan P0001 con el motivo en el TEXTO del mensaje, así que se reconoce por
 * subcadena. Es lo que ya hacía la web; lo que cambia es que ahora está en un solo
 * sitio y con tests, en vez de repetido en cada Server Action.
 *
 * `codigos` va en orden y ninguno es prefijo de otro, así que el primero que aparece
 * es el que toca.
 */
function errorDelRpc<T extends StaffIdentityError>(
  mensaje: string,
  codigos: readonly T[],
): T | 'generic' {
  for (const c of codigos) {
    if (mensaje.includes(c)) return c;
  }
  return 'generic';
}

export async function updateStaffNameFromClient(
  supabase: DbClient,
  params: { clubId: string; targetProfileId: string; fullName: string },
): Promise<StaffIdentityResult<StaffNameError>> {
  const parsed = staffNameInput(params.fullName);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { error } = await supabase.rpc('admin_update_staff_profile', {
    p_club_id: params.clubId,
    p_target_profile_id: params.targetProfileId,
    p_full_name: parsed.value,
  });
  if (error) {
    return {
      ok: false,
      error: errorDelRpc(error.message ?? '', [
        'forbidden',
        'target_invalid',
        'name_required',
        'name_too_long',
      ]),
    };
  }
  return { ok: true };
}

export async function updateStaffContactFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    targetProfileId: string;
    phone: string;
    contactEmail: string;
  },
): Promise<StaffIdentityResult<StaffContactError>> {
  const parsed = staffContactInput({
    phone: params.phone,
    contactEmail: params.contactEmail,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { error } = await supabase.rpc('admin_update_staff_contact', {
    // El SQL acepta NULL (los dos campos son opcionales) pero el typegen los escribe
    // como no nulos. Mismo apaño que ya llevaba la Server Action.
    p_club_id: params.clubId,
    p_target_profile_id: params.targetProfileId,
    p_phone: parsed.phone as unknown as string,
    p_contact_email: parsed.contactEmail as unknown as string,
  });
  if (error) {
    return {
      ok: false,
      error: errorDelRpc(error.message ?? '', [
        'forbidden',
        'target_invalid',
        'phone_invalid',
        'contact_email_invalid',
      ]),
    };
  }
  return { ok: true };
}

/**
 * El contacto ACTUAL de un miembro, para poder editarlo.
 *
 * Lectura aparte y NO metida en `getClubStaffFromClient` a propósito: esa lectura es
 * club-wide y su caché es club-scoped, así que añadirle teléfono y email dejaría el
 * contacto de TODO el cuerpo técnico guardado en el dispositivo por haber abierto una
 * lista. Aquí se pide solo al abrir la ficha de una persona.
 */
export type StaffContact = { phone: string | null; contactEmail: string | null };

export async function getStaffContactFromClient(
  supabase: DbClient,
  membershipId: string,
  onError?: (err: unknown) => void,
): Promise<StaffContact | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('phone, contact_email')
    .eq('id', membershipId)
    .maybeSingle();
  if (error) {
    onError?.(error);
    return null;
  }
  if (!data) return null;
  return { phone: data.phone ?? null, contactEmail: data.contact_email ?? null };
}
