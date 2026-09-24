/**
 * A-3 — QUE SE VEA que un correo de invitacion no llego.
 *
 * El listado tiene tres estados —Pendiente, Aceptada, Caducada— y los tres salen de
 * `accepted_at` y `expires_at`. Con eso, una invitacion que reboto se ve IGUAL que una
 * que esta sin abrir en la bandeja de alguien, y a los 7 dias pasa a «Caducada», que se
 * lee como «no la acepto» y no como «nunca le llego». El club persigue a una familia que
 * no ha recibido nada.
 *
 * Esto NO sustituye a ese estado: lo acompaña. Una invitacion puede estar Pendiente y
 * ademas no haber llegado; son dos preguntas distintas —¿la aceptaron? y ¿le llego?— y
 * mezclarlas en un solo campo obliga a elegir cual se pierde.
 */

/**
 * Lo que se le dice a quien mira la pantalla. Tres desenlaces, no seis: lo que necesita
 * saber es si tiene que perseguir a la familia o arreglar el correo.
 *
 *  · `ok`          — llego, o no tenemos nada que decir. NO se pinta nada: el silencio
 *                    es la buena noticia, y una marca por fila seria ruido en la que
 *                    funciona, que son casi todas.
 *  · `unconfirmed` — salio y no sabemos mas. Ver el umbral de abajo.
 *  · `failed`      — no llego y no va a llegar.
 */
export type InvitationDeliveryOutcome = 'ok' | 'unconfirmed' | 'failed';

/**
 * Los cuatro estados de Resend que significan "no llego y no va a llegar". La MISMA
 * lista que `k_terminales` en `apply_invitation_delivery_event` (migracion
 * 20261108000000), y por el mismo motivo que alli se unifico: si la pantalla y el
 * candado del SQL no dicen lo mismo, la pantalla acaba enseñando un fallo que la base
 * de datos ya dejo pisar.
 */
export const DELIVERY_FAILED_STATES = [
  'bounced',
  'complained',
  'failed',
  'suppressed',
] as const;

/**
 * EL UMBRAL, que es la unica decision de verdad de este fichero.
 *
 * MEDIDO el 24-sep-2026 contra produccion: un correo salio a las 14:27:00 y su evento
 * `delivered` llego a las 14:27:13.323. **Trece segundos.** Asi que un envio que sigue
 * en `sent` media hora despues no esta "tardando": le pasa algo.
 *
 * Y el caso que obliga a tener este estado, tambien medido: la invitacion a un dominio
 * inexistente NO reboto. Se quedo en `delivery_delayed` mas de cuatro horas —Amazon SES
 * trata un fallo de DNS como temporal y reintenta— y puede no rebotar nunca. Sin este
 * aviso, esa invitacion se ve SANA toda la tarde, y si el rebote no llega, para siempre.
 *
 * 30 minutos es mas de cien veces la entrega normal: falsos positivos practicamente
 * cero, y aun asi te enteras dentro de la misma tarde. Va en una constante y no
 * repartido por las pantallas porque la web y la nativa tienen que contar lo mismo.
 */
export const DELIVERY_UNCONFIRMED_AFTER_MS = 30 * 60 * 1000;

/** Lo que hace falta de una invitacion para decidir. */
export type DeliveryCarrier = {
  /** Null = nunca se intento seguir ese envio (invitaciones anteriores a A-2). */
  delivery_message_id: string | null;
  /** El estado que dijo Resend, tal cual. Null = no ha llegado ningun evento. */
  delivery_state: string | null;
  /** Cuando ocurrio el evento SEGUN RESEND. */
  delivery_at: string | null;
  /** Cuando se creo la invitacion: el reloj empieza aqui si no hay evento ninguno. */
  created_at: string;
};

/**
 * El desenlace de entrega de UNA invitacion.
 *
 * LA REGLA QUE MAS IMPORTA es la primera: **sin `delivery_message_id` no se dice nada**.
 * Son las invitaciones anteriores a A-2 —14 de las 16 que habia en produccion el dia que
 * esto se escribio— y de ellas no sabemos NADA, ni bueno ni malo. Si el umbral se les
 * aplicara, la pantalla se encenderia entera el primer dia con filas viejas y el aviso
 * dejaria de significar algo. "No sabemos" y "no llego" no son lo mismo.
 *
 * Un estado que no conocemos —Resend estrena uno manana— cae en `unconfirmed` y no en
 * `ok`: no vamos a decir que un correo llego basandonos en una palabra que no sabemos
 * leer.
 */
export function invitationDeliveryOutcome(
  inv: DeliveryCarrier,
  nowMs: number,
  unconfirmedAfterMs: number = DELIVERY_UNCONFIRMED_AFTER_MS,
): InvitationDeliveryOutcome {
  // 1 · Nunca se intento seguirla: no hay nada que contar.
  if (!inv.delivery_message_id) return 'ok';

  const estado = inv.delivery_state;

  // 2 · Un fallo es un fallo, por viejo que sea. No hay umbral que valga.
  if (estado && (DELIVERY_FAILED_STATES as readonly string[]).includes(estado)) {
    return 'failed';
  }

  // 3 · Llego. Lo unico que cierra el caso en bueno.
  if (estado === 'delivered') return 'ok';

  // 4 · Ni fallo ni entrega: `sent`, `delivery_delayed`, un estado que no conocemos, o
  //     ningun evento todavia. Aqui manda el reloj. Se cuenta desde el ULTIMO evento si
  //     lo hay —un `delivery_delayed` reciente es informacion fresca, no silencio— y si
  //     no, desde que se creo la invitacion.
  const desde = Date.parse(inv.delivery_at ?? inv.created_at);
  if (!Number.isFinite(desde)) return 'unconfirmed';
  return nowMs - desde >= unconfirmedAfterMs ? 'unconfirmed' : 'ok';
}
