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
 *   Censo de senders (2026-09-19) — quien añada el 9º, que se sume aquí:
 *     1 sendInvitation (invitations/actions.ts)      ✅ enlaza
 *     2 sendOrRenewTutorInvitation (jugadores)       ✅ enlaza
 *     3 inviteClubAdmin (platform/invite-club-admin) ✅ enlaza
 *     4 changeClubAdmin (platform/change-club-admin) ✅ enlaza
 *     5 inviteBatch (jugadores, import)              ✅ enlaza
 *     6 inviteStaffToTeam (equipos/[teamId])         ⛔ RETIRADO (BUG 3 · A-3)
 *     7 performSpectatorInvite (core/spectators)     ✅ enlaza (puerto inyectado)
 *     8 performSelfInvite (core/invitations)         ✅ enlaza (puerto inyectado)
 *   El 6 se fue cuando invitar dejó de vivir en la página de un equipo: quedan 7
 *   senders. El número NO se reutiliza — el siguiente es el 9 — para que los
 *   comentarios viejos que citan "el 6" sigan diciendo la verdad.
 *   El barrido de #540 buscó el `.update`, no el envío, y se le escaparon 5/6/7.
 *   Para encontrarlos todos: `grep -rn inviteUserByEmail`, NO grep del update.
 *
 *   El 7 y el 8 viven en `packages/core`, que NO puede importar Sentry ni este
 *   helper. Se resuelve con un PUERTO INYECTADO: cada uno recibe un parámetro
 *   `link` OBLIGATORIO (tipo `LinkInvitedUser`) y su adaptador de web
 *   (`lib/invite-spectator.ts`, `lib/invite-self.ts`) —único punto por el que pasan
 *   la Server Action y el route handler nativo— lo rellena con esta misma función. Así el guard no se
 *   duplica y el compilador impide enviar sin traer el enlazado.
 *
 *   GUARD DE CI: `pnpm check:invite-senders` (scripts/check-invite-senders.mjs)
 *   cuenta las llamadas reales a `auth.admin.inviteUserByEmail(` y las compara con
 *   el censo. Un sender nuevo rompe el PR hasta que alguien lea esto. Si tocas el
 *   censo aquí, tócalo TAMBIÉN allí.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WRAPPER `inviteAndLink` — RETIRADO (2026-09-19). Lo que se hizo y lo que no.
 * ─────────────────────────────────────────────────────────────────────────────
 *   Desde el 2026-09-03 aquí había un diseño aplazado: un wrapper único
 *   (`inviteAndLink`) que se tragara todo lo repetido en los senders —detectar
 *   "email ya registrado", el guard de `user.id` ausente, el try/catch y la
 *   orquestación envío+enlazado—. Esa nota se retira. Esto es lo que pasó.
 *
 *   SE HIZO, y no como refactor sino porque hacía falta arreglar algo:
 *     · `inviteEmailMetadata` (#650) — el `data` de los 7 envíos. Nació porque
 *       la plantilla del correo tenía que saber a QUIÉN escribe.
 *     · `sendInviteToExistingUser` (#651) — el camino de "ya tiene cuenta".
 *       Nació porque ese correo salía con asunto de restablecer contraseña.
 *     · `isEmailAlreadyExistsError` en los 5 sitios de web — este PR. Era la
 *       pieza pura: una función ya exportada por core y ya probada en unitarios,
 *       con el MISMO comportamiento que las copias a mano (`code === 'email_exists'`
 *       + los dos `includes`). Cero cambio de conducta, ningún correo que mandar
 *       para validarla.
 *
 *   QUEDA DUPLICADO, a propósito: el guard de `user.id` ausente y el try/catch
 *   de cada sender. Se parecen, pero no son lo mismo — cada uno decide distinto
 *   después: `inviteBatch` marca la fila del lote y sigue, `sendInvitation`
 *   devuelve error al admin, los de plataforma abortan. Lo repetido es la forma,
 *   no la decisión.
 *
 *   POR QUÉ EL WRAPPER COMPLETO SE RETIRA, y no es pereza:
 *
 *     1. El motivo original sigue en pie. Estos senders son EL ALTA DE TODOS LOS
 *        USUARIOS. CI no ejercita el envío (necesita GoTrue), así que una
 *        regresión no la caza el pipeline: se ve cuando un padre no entra.
 *
 *     2. Y ahora hay uno nuevo, que no existía en septiembre: el guard de censo
 *        (`scripts/check-invite-senders.mjs`) cuenta TRES literales por fichero
 *        —`auth.admin.inviteUserByEmail(`, `inviteEmailMetadata(` y
 *        `sendInviteToExistingUser(`— y exige que cuadren entre sí. Esconder el
 *        envío tras un wrapper los deja ciegos a los tres de golpe: un sender
 *        nuevo dejaría de aparecer en ningún censo, que es EXACTAMENTE el fallo
 *        histórico (agosto 2026: tres senders invisibles durante semanas).
 *        Extraer obliga a rediseñar antes cómo se vigila. No es un refactor
 *        neutro, y el refactor no vale lo que cuesta la vigilancia.
 *
 *     3. Lo que quedaba de verdad duplicado era la detección, y ya está fuera.
 *        Lo que queda (punto anterior) no es duplicación: es forma parecida con
 *        decisiones distintas.
 *
 *   SI ALGUIEN LO RESUCITA algún día, que empiece por el guard, no por el
 *   wrapper: mientras el censo cuente literales, el wrapper es un retroceso.
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
