import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  pendingInvitationsForEmailFromClient,
  type Database,
  type PendingInvitationRow,
} from '@misterfc/core';

/**
 * ¿Qué invitaciones PENDIENTES vigentes tiene ya ese correo en este club?
 *
 * La mitad que faltaba de «un correo pertenece a una sola familia». La otra la
 * contesta `club_member_by_email` — «¿ya es de alguien del club?» — y no llega
 * hasta aquí: LA MEMBERSHIP NACE AL ACEPTAR, así que entre invitar y aceptar ese
 * correo es invisible para ella. Por esa ventana salía un segundo correo a la
 * misma persona.
 *
 * W-6 — la consulta y su regla («si la RPC tropieza, lista vacía») viven en core
 * (`pendingInvitationsForEmailFromClient`), porque el flujo de invitar bajó allí y la
 * regla no puede estar en dos sitios. Aquí queda solo la inyección de Sentry.
 *
 * Por qué va por RPC y no por un `select`: la policy de `invitations` solo deja leer
 * la tabla a dirección, al invitado y a quien creó la fila, y esto lo pregunta también
 * un entrenador —puede crear jugadores, y crear un jugador dispara la invitación del
 * tutor—. Con un `select` vería cero pendientes y mandaría el correo igual.
 *
 * FALLA ABIERTO, a propósito: un fallo del atajo no puede dejar a un padre sin su
 * correo; el precio es un correo de más en un caso que además se registra en Sentry.
 */
export async function pendingInvitationsForEmail(
  supabase: SupabaseClient<Database>,
  clubId: string,
  email: string,
  step: string,
): Promise<PendingInvitationRow[]> {
  return pendingInvitationsForEmailFromClient(
    supabase,
    clubId,
    email,
    (error, paso, extra) => {
      Sentry.captureException(error, {
        tags: { feature: 'invitations', step: paso },
        extra,
      });
    },
    step,
  );
}
