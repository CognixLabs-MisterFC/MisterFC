import * as Sentry from '@sentry/nextjs';
import type { createSupabaseAdminClient } from '@misterfc/core';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * CONTRATO (léelo antes de escribir un sender nuevo):
 *   TODO sitio que llame a `admin.auth.admin.inviteUserByEmail(...)` y CREE la
 *   cuenta (es decir, la rama SIN error / SIN fallback a resetPasswordForEmail)
 *   DEBE enlazar después el `auth.users.id` en `invitations.invited_user_id`
 *   llamando a esta función. Sin ese enlazado, chooseInviteForm no puede enrutar
 *   al form set_password por id y el invitee cae en la trampa (lo tapa el cinturón
 *   #539, pero se pierde el enlazado). NO basta con enviar el email.
 *
 *   Censo de senders (2026-09-03) — quien añada el 8º, que se sume aquí:
 *     1 sendInvitation (invitations/actions.ts)      ✅ enlaza
 *     2 sendOrRenewTutorInvitation (jugadores)       ✅ enlaza
 *     3 inviteClubAdmin (platform/invite-club-admin) ✅ enlaza
 *     4 changeClubAdmin (platform/change-club-admin) ✅ enlaza
 *     5 inviteBatch (jugadores, import)              ✅ enlaza
 *     6 inviteStaffToTeam (equipos/[teamId])         ✅ enlaza
 *     7 performSpectatorInvite (core/spectators)     ✅ enlaza (puerto inyectado)
 *   El barrido de #540 buscó el `.update`, no el envío, y se le escaparon 5/6/7.
 *   Para encontrarlos todos: `grep -rn inviteUserByEmail`, NO grep del update.
 *
 *   El 7 vive en `packages/core`, que NO puede importar Sentry ni este helper. Se
 *   resuelve con un PUERTO INYECTADO: `performSpectatorInvite` recibe un parámetro
 *   `link` OBLIGATORIO (tipo `LinkInvitedUser`) y el adaptador de web
 *   `lib/invite-spectator.ts` —único punto por el que pasan la Server Action y el
 *   route handler nativo— lo rellena con esta misma función. Así el guard no se
 *   duplica y el compilador impide enviar sin traer el enlazado.
 *
 *   GUARD DE CI: `pnpm check:invite-senders` (scripts/check-invite-senders.mjs)
 *   cuenta las llamadas reales a `auth.admin.inviteUserByEmail(` y las compara con
 *   el censo. Un 8º sender rompe el PR hasta que alguien lea esto. Si tocas el
 *   censo aquí, tócalo TAMBIÉN allí.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOLLOW-UP DISEÑADO Y APLAZADO — wrapper `inviteAndLink` (decisión 2026-09-03)
 * ─────────────────────────────────────────────────────────────────────────────
 *   El "email ya registrado" está reimplementado a mano en CINCO ficheros de web
 *   (`code === 'email_exists'` + dos `includes`), mientras core ya exporta
 *   `isEmailAlreadyExistsError`. Lo mismo con el guard de `user.id` ausente y el
 *   try/catch. Un wrapper único lo unificaría:
 *
 *     packages/core/src/invitations/invite-and-link.ts
 *       inviteAndLink({ admin, resetClient, email, redirectTo, metadata,
 *                       invitationIds, link, log })
 *         → { sent: 'created' } | { sent: 'existing' }
 *         | { error: 'send_failed' | 'missing_user_id' | 'link_failed' }
 *
 *   Con dos invariantes: los puertos (`link`, `log`) se inyectan —core sigue sin
 *   Sentry— y el wrapper NUNCA hace efectos secundarios: no borra invitaciones ni
 *   marca filas de lote; devuelve el resultado y decide el llamador (inviteBatch
 *   borra al fallar el envío pero NO al fallar el enlazado, y no aborta el lote).
 *
 *   NO se hizo ahora, y la razón vale para el que lo lea dentro de seis meses:
 *   estos seis senders son el ALTA DE TODOS LOS USUARIOS, hoy correctos y
 *   verificados en producción; CI no ejercita el envío (necesita GoTrue), así que
 *   una regresión no la caza el pipeline y solo se ve cuando un padre no entra;
 *   y validarlo obliga a mandar correos reales por sender y por estado (email
 *   nuevo / email existente / fallo). El guard de CI de arriba ataca el fallo
 *   histórico real (un sender nuevo que nadie ve) sin tocar el alta.
 *
 *   ORDEN DE ADOPCIÓN si algún día se hace, de menos a más riesgo:
 *     1º performSpectatorInvite (seguidores: sin él nadie se queda fuera del club)
 *     2º inviteClubAdmin y changeClubAdmin (superadmin, tráfico mínimo: si rompen,
 *        afectan a Jose, no a una familia)
 *     3º inviteStaffToTeam
 *     último, o NUNCA: inviteBatch, sendOrRenewTutorInvitation, sendInvitation
 *        (lote del import, alta de tutores y alta general: máximo tráfico y
 *        post-condiciones propias)
 *   Regla: migrar un sender por PR, con verificación manual de sus tres estados.
 *   Y no migrar ninguno "de paso": solo cuando se toque por otra razón.
 *
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
