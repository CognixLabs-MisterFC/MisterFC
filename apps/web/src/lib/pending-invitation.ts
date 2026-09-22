import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PendingInvitationRow } from '@misterfc/core';

/**
 * ¿Qué invitaciones PENDIENTES vigentes tiene ya ese correo en este club?
 *
 * La mitad que faltaba de «un correo pertenece a una sola familia». La otra la
 * contesta `club_member_by_email` — «¿ya es de alguien del club?» — y no llega
 * hasta aquí: LA MEMBERSHIP NACE AL ACEPTAR, así que entre invitar y aceptar ese
 * correo es invisible para ella. Por esa ventana salía un segundo correo a la
 * misma persona.
 *
 * Va por RPC (`club_pending_invitation_by_email`, mig 20261095000000) y no por un
 * `select`: la policy de `invitations` solo deja leer la tabla a dirección, al
 * invitado y a quien creó la fila, y aquí pregunta también un entrenador —puede
 * crear jugadores, y crear un jugador dispara la invitación del tutor—. Con un
 * `select` vería cero pendientes y mandaría el correo igual.
 *
 * FALLA ABIERTO, a propósito: si la RPC tropieza se devuelve lista vacía, que es
 * «no hay nada pendiente» y lleva al camino de siempre (invitar). Un fallo del
 * atajo no puede dejar a un padre sin su correo; el precio es un correo de más en
 * un caso que además se registra en Sentry.
 */
export async function pendingInvitationsForEmail(
  supabase: SupabaseClient<Database>,
  clubId: string,
  email: string,
  step: string,
): Promise<PendingInvitationRow[]> {
  const { data, error } = await supabase.rpc('club_pending_invitation_by_email', {
    p_club_id: clubId,
    p_email: email,
  });
  if (error) {
    Sentry.captureException(error, {
      tags: { feature: 'invitations', step },
      extra: { club_id: clubId },
    });
    return [];
  }
  return (data ?? []).map((row) => ({ id: row.invitation_id }));
}
