import * as Sentry from '@sentry/nextjs';
import type { createSupabaseAdminClient } from '@misterfc/core';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Enlaza `invitations.invited_user_id` y EXIGE que el UPDATE afecte exactamente
 * 1 fila.
 *
 * Motivo (incidente invitación, ago-2026): PostgREST NO devuelve error cuando un
 * UPDATE no casa ninguna fila. Los senders hacían `.update().eq('id', …)` sin
 * `.select()`, así que un UPDATE de CERO filas era 100% silencioso (sin error, sin
 * evento, sin error al admin) y dejaba `invited_user_id` NULL → invitación rota
 * (el envío "creía" haber enlazado). Descartadas por inspección la causa RLS
 * (el link va con service-role en los 4 senders), el orden del INSERT (va antes,
 * awaited) y triggers/segundas escrituras (ninguna toca invited_user_id).
 *
 * Aquí pedimos la representación (`.select('id')`) y tratamos ≠1 fila como fallo:
 *  - Sentry ruidoso con `affected` y `row_exists_now` (un re-SELECT por id) para,
 *    en la próxima reproducción, distinguir "el id no casó nunca" de un problema
 *    de visibilidad.
 *  - `console.error` además de Sentry (no depender solo de Sentry, que
 *    históricamente ha fallado en servidor).
 *  - Devuelve `{ ok: false }` para que el sender corte y devuelva error al admin,
 *    en vez de entregar una invitación rota.
 */
export async function linkInvitedUser(
  admin: AdminClient,
  invitationId: string,
  invitedUserId: string,
  ctx: { feature: 'invitations' | 'platform'; step: string; maskedEmail?: string },
): Promise<{ ok: true } | { ok: false }> {
  const extra = { invitation_id: invitationId, masked_email: ctx.maskedEmail };

  const { data: linked, error } = await admin
    .from('invitations')
    .update({ invited_user_id: invitedUserId })
    .eq('id', invitationId)
    .select('id');

  if (error) {
    console.error(
      '[invitations] link_invited_user_failed ' + JSON.stringify({ step: ctx.step, ...extra }),
    );
    Sentry.captureException(error, { tags: { feature: ctx.feature, step: ctx.step }, extra });
    return { ok: false };
  }

  if (!linked || linked.length !== 1) {
    const { data: probe } = await admin
      .from('invitations')
      .select('id')
      .eq('id', invitationId);
    const detail = {
      ...extra,
      affected: linked?.length ?? 0,
      row_exists_now: (probe?.length ?? 0) > 0,
    };
    console.error(
      '[invitations] link_invited_user_zero_rows ' + JSON.stringify({ step: ctx.step, ...detail }),
    );
    Sentry.captureMessage(
      '[invitations] link UPDATE afectó ≠1 fila (invited_user_id no guardado)',
      {
        level: 'error',
        tags: { feature: ctx.feature, step: `${ctx.step}_zero_rows` },
        extra: detail,
      },
    );
    return { ok: false };
  }

  return { ok: true };
}
