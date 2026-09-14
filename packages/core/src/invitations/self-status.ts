import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type DbClient = SupabaseClient<Database>;

/**
 * MN-9 — El estado de la cuenta propia del jugador, para que la tarjeta del tutor
 * deje de ofrecer lo que ya está hecho.
 *
 * EL DEFECTO QUE CIERRA. La tarjeta «dar acceso al jugador» se pintaba mirando la
 * relación de QUIEN MIRA (`relation !== 'self'`). La del tutor es 'parent' para
 * siempre, así que la tarjeta no se iba nunca: el hijo ya entraba con su cuenta y su
 * padre seguía viendo el botón, que solo fallaba al pulsarlo con `already_linked`.
 *
 * POR QUÉ NO SE PUEDE RESOLVER LEYENDO `player_accounts`. El tutor NO VE la fila
 * 'self' de su hijo: `player_accounts_select_self_or_staff` solo deja ver la fila
 * propia o las del staff. Medido en producción con la sesión del tutor, sobre el
 * hijo que YA tiene cuenta, la tabla devuelve únicamente `…:parent`. Y así debe
 * seguir. De ahí la RPC, que devuelve EL ESTADO y nada más: ni el perfil que hay
 * detrás, ni el correo.
 *
 * UNA SOLA REGLA PARA LAS DOS SUPERFICIES. La RPC está gateada con
 * `user_manages_player`, no con `user_is_tutor_of_player`, y eso es lo que permite
 * que la interfaz no tenga que preguntar aparte por la relación: al PROPIO JUGADOR
 * —el menor con su cuenta, o el adulto con la suya— le contesta 'linked' por
 * construcción (si puede preguntar, es que su fila 'self' existe), así que la
 * tarjeta le desaparece por el MISMO camino que al tutor de un hijo ya enlazado.
 *
 * ESTO DECIDE QUÉ SE OFRECE, NO QUÉ SE PERMITE. La autoridad final sigue siendo
 * `invite_player_self`, que conserva su propio `already_linked`. Entre que se pinta
 * la pantalla y se pulsa el botón el estado puede quedar rancio —otro tutor
 * invitando a la vez, la invitación caducando— y por eso el error de la RPC se
 * sigue mostrando. Lo que cambia es que ya no es el camino normal.
 */
export type SelfAccountStatus =
  /** Ni cuenta propia ni invitación viva: se ofrece invitar. */
  | 'none'
  /** Invitación enviada, sin aceptar y sin caducar: se dice que está pendiente. */
  | 'invited'
  /** El jugador ya tiene su cuenta: no se ofrece nada. */
  | 'linked';

const KNOWN: readonly string[] = ['none', 'invited', 'linked'];

/**
 * Lee el estado de la cuenta propia de un jugador.
 *
 * Devuelve `null` cuando NO se ha podido saber (error de red, `forbidden` porque
 * quien pregunta no gestiona a ese jugador, o un valor que no reconocemos). El
 * caller trata `null` como «no ofrecer», que es la misma convención que ya sigue
 * esta pantalla con `canManage ?? false`: una lectura que falla no abre puertas.
 *
 * postgrest-js NO rechaza la promesa, así que el error se comprueba mirando
 * `error`, no con un try/catch.
 */
export async function getSelfAccountStatusFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<SelfAccountStatus | null> {
  const { data, error } = await supabase.rpc('player_self_account_status', {
    p_player_id: playerId,
  });
  if (error) return null;
  return typeof data === 'string' && KNOWN.includes(data)
    ? (data as SelfAccountStatus)
    : null;
}
