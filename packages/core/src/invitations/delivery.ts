/**
 * A-2 — El OTRO extremo del hilo: apuntar en la invitación el id del correo que se
 * acaba de mandar. Sin esto el webhook no tiene con qué casar y `rows` sería siempre 0.
 *
 * REPARTO, que conviene no confundir:
 *   · esto escribe `delivery_message_id`, UNA vez, justo después de enviar;
 *   · `apply_invitation_delivery_event` (A-1, SQL) escribe el estado, tantas veces como
 *     eventos lleguen, y es el único que lo hace.
 *
 * VARIAS FILAS POR CORREO. `inviteBatch` manda UN solo correo por familia con la primera
 * invitación de ancla, así que un padre con dos hijos recibe un correo que vale por dos
 * filas. Por eso el parámetro es una LISTA: si se apuntara solo en el ancla, el rebote de
 * ese correo dejaría al segundo hijo con la invitación muda, que es exactamente el fallo
 * que A-1/A-2/A-3 existen para cerrar.
 *
 * NO ROMPE UNA INVITACIÓN BUENA. El correo ya ha salido cuando esto corre. Si la
 * escritura falla, lo que se pierde es saber qué fue de ese correo —una degradación de
 * lo que vemos, no de lo que el invitado recibe—, así que se registra y se sigue.
 * Devolver error aquí haría que `inviteBatch` BORRARA las invitaciones recién creadas
 * (su rama `sendReason`) por un fallo que no afecta al invitado: el remedio sería peor.
 *
 * Se escribe con el cliente de SERVICE-ROLE. `invitations` no tiene política de UPDATE
 * que permita a quien invita tocar estas columnas, y no se le va a añadir una: cuanto
 * menos pueda escribir la sesión del navegador en esta tabla, mejor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type AdminClient = SupabaseClient<Database>;

/**
 * El mismo logger que ya inyectan los senders (Sentry en web).
 *
 * `extra` es OBLIGATORIO, con la misma forma que `SelfInviteLogger` y
 * `SpectatorInviteLogger`: si aquí fuera opcional, los dos senders de core no podrían
 * pasar el suyo —una función que EXIGE `extra` no vale donde se la puede llamar sin
 * él— y habría que envolverlo en cada llamada. Además aquí siempre hay algo que
 * contar: de qué invitaciones se trata.
 */
export type DeliveryRecordLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;

/**
 * Apunta `delivery_message_id` en todas las invitaciones que cubre ese correo.
 *
 * `messageId` puede venir vacío: `sendEmail` devuelve `{ error: null }` sin `id` si
 * Resend contesta 200 con un cuerpo que no se puede leer. Eso no es un fallo de envío
 * —el correo salió— pero sí deja esa invitación sin seguimiento, y se avisa: es la
 * única forma de enterarse de que el rastro se ha roto.
 */
export async function recordInvitationDelivery(
  admin: AdminClient,
  invitationIds: readonly string[],
  messageId: string | null | undefined,
  log: DeliveryRecordLogger,
  step: string,
): Promise<void> {
  if (invitationIds.length === 0) return;

  if (!messageId) {
    log(new Error('Resend aceptó el envío sin devolver id'), `${step}_sin_id`, {
      invitation_ids: [...invitationIds],
    });
    return;
  }

  // El try/catch NO es decorativo. Los dos senders de core llaman a esto DENTRO del
  // `try` que envuelve el envío: una excepción aquí caería en su `catch`, devolvería
  // 'generic' y tumbaría una invitación que ya ha salido bien. Que esta función no
  // lance es parte de su contrato, no una casualidad de su implementación.
  try {
    const { data, error } = await admin
      .from('invitations')
      .update({ delivery_message_id: messageId })
      .in('id', invitationIds as string[])
      .select('id');

    if (error) {
      log(error, step, { invitation_ids: [...invitationIds] });
      return;
    }

    // PostgREST NO da error cuando un UPDATE no casa ninguna fila (el incidente de
    // agosto de 2026, ver `link-invited-user.ts`). Sin pedir la representación, un cero
    // sería mudo y el rastro se perdería sin que nadie lo supiera.
    const tocadas = data?.length ?? 0;
    if (tocadas !== invitationIds.length) {
      log(new Error('el id del envío no se apuntó en todas las invitaciones'), `${step}_filas`, {
        esperadas: invitationIds.length,
        tocadas,
        invitation_ids: [...invitationIds],
      });
    }
  } catch (thrown) {
    log(thrown, `${step}_thrown`, { invitation_ids: [...invitationIds] });
  }
}
