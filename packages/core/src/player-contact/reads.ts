import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

/**
 * Los datos de CONTACTO de un jugador: su teléfono y el de cada tutor, con el
 * correo. Lo consumen la ficha de la web y la de la app, que pintan lo mismo.
 *
 * Ninguno de los dos sale de un `select`. Desde la migración 20261057000000:
 *
 *   · `players.phone` y `profiles.phone` NO son legibles por el cliente (se
 *     revocó el SELECT de tabla y se reconcedió columna a columna). Nombrarlas
 *     en un select devuelve 42501 y —esto es lo que muerde— el error habla de
 *     la TABLA, así que se cae la consulta entera, no solo el campo.
 *   · el correo vive en `auth.users`, que PostgREST no expone.
 *
 * La puerta es `user_can_access_player_contact`: cuerpo técnico del club del
 * jugador (alcance CLUB, no equipo) y el tutor vinculado. Quien no pase, recibe
 * `forbidden` de la RPC. Por eso el resultado distingue tres cosas y no dos:
 *
 *   ok:true      → hay acceso; `playerPhone` en null significa que no hay
 *                  teléfono, no que haya fallado nada,
 *   forbidden    → quien mira no tiene acceso: la pantalla NO pinta el bloque,
 *   error        → algo se rompió: la pantalla lo DICE, no finge un vacío.
 *
 * Esa distinción es el motivo de que esto no devuelva un simple array: un fallo
 * pintado como «sin teléfonos» es exactamente el aviso que nadie va a leer.
 */
type DbClient = SupabaseClient<Database>;

export type PlayerTutorContact = {
  tutorProfileId: string;
  fullName: string | null;
  /** parent | guardian | self | other — el mismo enum de `player_accounts`. */
  relation: string;
  email: string | null;
  phone: string | null;
};

export type PlayerContactResult =
  | { ok: true; playerPhone: string | null; tutors: PlayerTutorContact[] }
  | { ok: false; reason: 'forbidden' | 'error' };

/** Datos de auditoría del lector. La RPC los guarda en `audit_log`. */
export type ContactAudit = { ip?: string | null; userAgent?: string | null };

function reasonOf(message: string | undefined): 'forbidden' | 'error' {
  return message?.includes('forbidden') ? 'forbidden' : 'error';
}

/**
 * Teléfono del jugador + contacto de sus tutores, en una sola llamada para quien
 * pinta. Las dos RPC van EN PARALELO: comparten puerta, así que o entran las dos
 * o no entra ninguna, y encadenarlas solo sumaría latencia a una ficha.
 *
 * `ip`/`userAgent` se pasan al servidor para el apunte `contact.read` del
 * registro de auditoría, igual que hace la ficha médica. Cuando quien mira ES el
 * tutor del jugador, la RPC no apunta nada: nadie audita a un padre mirando el
 * teléfono de su hijo.
 */
export async function getPlayerContactFromClient(
  supabase: DbClient,
  playerId: string,
  audit?: ContactAudit,
): Promise<PlayerContactResult> {
  const args = {
    p_player_id: playerId,
    p_ip: audit?.ip ?? undefined,
    p_user_agent: audit?.userAgent ?? undefined,
  };

  const [phoneRes, tutorsRes] = await Promise.all([
    supabase.rpc('get_player_phone', args),
    supabase.rpc('get_player_tutors_contact', args),
  ]);

  if (phoneRes.error || tutorsRes.error) {
    return {
      ok: false,
      reason: reasonOf(phoneRes.error?.message ?? tutorsRes.error?.message),
    };
  }

  const tutors: PlayerTutorContact[] = (tutorsRes.data ?? []).map((row) => ({
    tutorProfileId: row.tutor_profile_id,
    fullName: row.full_name ?? null,
    relation: row.relation,
    email: row.email ?? null,
    phone: row.phone ?? null,
  }));

  return {
    ok: true,
    playerPhone: (phoneRes.data as string | null) ?? null,
    tutors,
  };
}
