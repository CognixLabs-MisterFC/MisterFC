import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { SelfAccountStatus } from './self-status';

type DbClient = SupabaseClient<Database>;

/**
 * RC-2 — el TUTOR retira la cuenta propia de su hijo.
 *
 * La acción simétrica de `performSelfInvite`, y mucho más simple: aquí no hay correo
 * que mandar ni cuenta que crear, así que no hace falta service-role ni un route
 * handler. Se llama con el cliente RLS del usuario y punto — la autoridad entera vive
 * en `revoke_player_self_account` (migración 20261100000000).
 *
 * QUÉ RETIRA. Los dos estados de MN-9 que pueden dar acceso: la cuenta ya creada
 * (`player_accounts.relation='self'`) y la invitación todavía viva. Si cubriera solo
 * la primera, el tutor retiraría hoy y el crío entraría mañana con el enlace que
 * seguía vivo.
 *
 * QUÉ NO TOCA. `players`, `team_members`, la ficha, el equipo y las convocatorias: el
 * niño sigue siendo jugador del club. Lo que cae es el acceso a la app.
 */

/**
 * Qué había que retirar. Lo devuelve el SQL, y sirve para decir la frase correcta:
 * cancelar una invitación que nadie llegó a usar no es lo mismo que quitarle el
 * acceso a quien ya estaba dentro.
 */
export type SelfRevokeOutcome =
  /** Tenía cuenta propia y se ha retirado. */
  | 'account'
  /** No tenía cuenta, pero había una invitación viva y se ha cancelado. */
  | 'invitation'
  /** No había nada que retirar. Pasa de verdad: dos tutores a la vez, o doble clic. */
  | 'none';

export type SelfRevokeError =
  /** Quien llama no es tutor (parent/guardian) de ese jugador. */
  | 'forbidden'
  /** El jugador ya es mayor de edad: su cuenta es suya y el tutor no la toca. */
  | 'jugador_mayor_de_edad'
  | 'generic';

/**
 * El `raw` viaja con el error para que el llamante pueda reportar a Sentry lo que no
 * sabemos explicar, sin que core dependa de Sentry. Mismo contrato que
 * `removeSpectatorFromClient`.
 */
export type SelfRevokeResult =
  | { ok: SelfRevokeOutcome }
  | { error: SelfRevokeError; raw?: unknown };

const OUTCOMES: readonly string[] = ['account', 'invitation', 'none'];

/**
 * Los gates de la RPC, mapeados de uno en uno, por `includes` sobre el mensaje: es
 * como llegan los `raise exception` de plpgsql a PostgREST, igual que en
 * `performSelfInvite` y en el resto del proyecto.
 *
 * `no_session` NO se mapea, por el mismo motivo que allí: si no hay sesión no se
 * llega hasta aquí, y confundirlo con un gate de negocio haría pensar en un permiso
 * donde solo hay una sesión caducada.
 */
export function mapSelfRevokeError(message: string): SelfRevokeError {
  const msg = message.toLowerCase();
  if (msg.includes('jugador_mayor_de_edad')) return 'jugador_mayor_de_edad';
  if (msg.includes('forbidden')) return 'forbidden';
  return 'generic';
}

/**
 * postgrest-js NO rechaza la promesa: el error se mira en `error`, no con try/catch.
 *
 * UN VALOR QUE NO RECONOCEMOS SE TRATA COMO ERROR, y no como 'none'. Decir «no había
 * nada que retirar» cuando quizá sí lo había es la única respuesta que miente, y el
 * reintento no cuesta nada: la RPC es idempotente. Además la tarjeta se relee después,
 * así que lo que el tutor acaba viendo es el estado real y no nuestra suposición.
 */
export async function revokePlayerSelfAccountFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<SelfRevokeResult> {
  const { data, error } = await supabase.rpc('revoke_player_self_account', {
    p_player_id: playerId,
  });
  if (error) {
    const mapped = mapSelfRevokeError(error.message ?? '');
    // Los gates son respuestas esperadas del negocio, no incidencias: solo se pasa
    // `raw` de lo que no sabemos explicar.
    return mapped === 'generic' ? { error: mapped, raw: error } : { error: mapped };
  }
  return typeof data === 'string' && OUTCOMES.includes(data)
    ? { ok: data as SelfRevokeOutcome }
    : { error: 'generic', raw: new Error(`revoke_player_self_account devolvio ${JSON.stringify(data)}`) };
}

/**
 * Los DOS predicados con los que la RPC se gatea, preguntados tal cual.
 *
 * No se derivan de `canManageSensitive` aunque hoy den lo mismo para un menor
 * (`user_manages_player_sensitive` = tutor, o el jugador adulto sobre su propia
 * ficha). Un equivalente no es el mismo predicado: el día que uno cambie, la tarjeta
 * y el botón dirían cosas distintas, que es exactamente el defecto que MN-9 vino a
 * cerrar y el que MN-10 evitó mudando el bloqueador a un solo sitio.
 *
 * Una lectura que falla NO abre puertas: si no se pudo saber, no se ofrece. Misma
 * convención que `getSelfAccountStatusFromClient` con su `null`.
 */
export type SelfRevokeGate = {
  /** `user_is_tutor_of_player` — parent/guardian. Desde MN-1 no cuenta 'self'. */
  isTutor: boolean;
  /** `player_is_minor` — sobre `players.date_of_birth`, NOT NULL y al 100%. */
  isMinor: boolean;
};

export async function getSelfRevokeGateFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<SelfRevokeGate> {
  const [{ data: tutor }, { data: minor }] = await Promise.all([
    supabase.rpc('user_is_tutor_of_player', { p_player_id: playerId }),
    supabase.rpc('player_is_minor', { p_player_id: playerId }),
  ]);
  return { isTutor: Boolean(tutor), isMinor: Boolean(minor) };
}

/**
 * ¿Se le ofrece al que mira el botón de retirar?
 *
 * POR QUÉ NO BASTA CON EL ESTADO. `player_self_account_status` está gateada con
 * `user_manages_player`, así que al PROPIO JUGADOR le contesta 'linked' igual que a
 * su padre (MN-9 lo hace a propósito, para que la tarjeta de invitar desaparezca por
 * una sola regla). Si el botón colgara solo del estado, un chaval de 18 con su cuenta
 * se encontraría un «retirar mi cuenta» que el SQL le va a negar — el botón muerto por
 * gate mudo que MN-6 y MN-9 llevan dos PRs quitando de esta misma pantalla.
 *
 * Vive en core, y no en cada pantalla, por lo de siempre: web y nativa deciden lo
 * mismo, y una regla escrita dos veces se queda coja en una.
 */
export function canOfferSelfRevoke(args: {
  status: SelfAccountStatus | null;
  gate: SelfRevokeGate;
}): boolean {
  const { status, gate } = args;
  if (!gate.isTutor || !gate.isMinor) return false;
  return status === 'linked' || status === 'invited';
}

/**
 * La clave de texto del aviso de «hecho», dentro del bloque `invite_self.revoke`.
 * Tres, y no una: cancelar una invitación que nadie usó, quitarle el acceso a quien ya
 * estaba dentro y no encontrar nada que retirar son tres hechos distintos, y el tutor
 * necesita saber cuál de los tres ha pasado.
 */
export function selfRevokeDoneMessageKey(outcome: SelfRevokeOutcome): string {
  return `done.${outcome}`;
}
