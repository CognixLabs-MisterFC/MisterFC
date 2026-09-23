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
 * MN-10 — a los tres estados de arriba se suman los TRES motivos por los que
 * invitar fallaría: jugador de baja, club sin temporada abierta y decisiones de
 * imagen sin responder. Son motivos y no un booleano a propósito: al tutor al que
 * le falta el consentimiento hay que decirle ESO, no «no se puede». El predicado no
 * está escrito aquí ni en la RPC: vive en `player_self_invite_blocker`, que es lo
 * que ejecutan las dos, así que la tarjeta y el botón no pueden discrepar.
 *
 * ESTO DECIDE QUÉ SE OFRECE, NO QUÉ SE PERMITE. La autoridad final sigue siendo
 * `invite_player_self`, que conserva su propio `already_linked`. Entre que se pinta
 * la pantalla y se pulsa el botón el estado puede quedar rancio —otro tutor
 * invitando a la vez, la invitación caducando— y por eso el error de la RPC se
 * sigue mostrando. Lo que cambia es que ya no es el camino normal.
 */
export type SelfAccountStatus =
  /** Ni cuenta propia ni invitación viva, y nada que lo bloquee: se ofrece invitar. */
  | 'none'
  /** Invitación enviada, sin aceptar y sin caducar: se dice que está pendiente. */
  | 'invited'
  /** El jugador ya tiene su cuenta: no se ofrece nada. */
  | 'linked'
  /** MN-10 — el jugador está dado de baja. */
  | 'erased'
  /** MN-10 — el club no tiene ninguna temporada abierta. */
  | 'no_active_season'
  /** MN-10 — faltan las decisiones de imagen de la temporada activa. */
  | 'consents_required'
  /**
   * RC-A — quien pregunta tiene un borrado de su propia cuenta EN CURSO. Es el único
   * estado que NO habla del jugador sino del tutor que mira: el mismo crío le sale
   * bloqueado a un tutor que se está borrando y disponible al otro que no. Lo decide
   * `player_self_invite_blocker` (mig 20261103000000), y se desbloquea solo en cuanto
   * el borrado se cancela o se remata: no hay estado propio que limpiar.
   */
  | 'account_deletion_pending';

/**
 * MN-10 + RC-A — los motivos por los que `invite_player_self` se negaría con el tutor
 * delante y que sí se pueden saber antes de pulsar. `email_relation_conflict` NO está
 * aquí y no es un olvido: se mide contra una dirección concreta, la que el tutor
 * todavía no ha escrito, así que no existe un valor que calcular a priori. Ese sigue
 * saliendo como error bajo el campo.
 *
 * Los tres primeros son del JUGADOR. `account_deletion_pending` es del TUTOR QUE MIRA
 * —lo añadió RC-A—, y aun así va en la misma lista: para la pantalla, «esto bloquea el
 * botón y hay que decir por qué» es la misma cosa, venga de donde venga.
 */
export const SELF_ACCOUNT_BLOCKERS = [
  'erased',
  'no_active_season',
  'consents_required',
  'account_deletion_pending',
] as const;

export type SelfAccountBlocker = (typeof SELF_ACCOUNT_BLOCKERS)[number];

/** `true` si el estado es un motivo de bloqueo (y por tanto hay algo que arreglar). */
export function isSelfAccountBlocker(
  estado: SelfAccountStatus,
): estado is SelfAccountBlocker {
  return (SELF_ACCOUNT_BLOCKERS as readonly string[]).includes(estado);
}

const KNOWN: readonly string[] = [
  'none',
  'invited',
  'linked',
  ...SELF_ACCOUNT_BLOCKERS,
];

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

/**
 * MN-10 — la clave de texto que le toca a cada estado, DENTRO del bloque
 * `invite_self`. `null` para 'none', que es el único que no dice nada: enseña la
 * explicación de siempre y el botón.
 *
 * Los tres motivos de bloqueo reutilizan los textos de `errors.*`, que ya existían
 * en los tres idiomas para cuando la RPC se negaba DESPUÉS de pulsar. No se
 * escriben otros nuevos a propósito: la tarjeta y el error tienen que decir la
 * misma frase, y dos frases distintas para el mismo hecho acaban divergiendo igual
 * que divergen dos predicados.
 *
 * Vive en core, y no en cada pantalla, por lo mismo: web y nativa pintan los mismos
 * estados cada una, y una lista escrita dos veces se queda coja en una. Sin número
 * escrito a mano: eran seis, RC-A hizo siete, y un recuento en un comentario no lo
 * comprueba nadie.
 */
export function selfAccountStatusMessageKey(
  estado: SelfAccountStatus,
): string | null {
  if (estado === 'none') return null;
  if (estado === 'invited') return 'state.invited';
  if (estado === 'linked') return 'state.linked';
  return `errors.${estado}`;
}
