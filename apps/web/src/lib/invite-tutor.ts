import 'server-only';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  inviteEmailMetadata,
  isEmailAlreadyExistsError,
  inviteLink,
} from '@misterfc/core';
import { linkInvitedUser } from '@/lib/link-invited-user';
import { invitationEmailPort, inviteRecipientPort } from '@/lib/email/invite-ports';

/**
 * Circuito ÚNICO de invitación de TUTOR — lo comparten el alta manual de jugador
 * (`createPlayer`) y el botón de la ficha (`inviteTutorForPlayer`).
 *
 * Correo-B4 — POR QUÉ SE MUDA DE FICHERO. Vivía dentro de
 * `jugadores/actions.ts`, al lado de `inviteBatch`. Al migrarlo a Resend los dos
 * quedaban en el mismo fichero con formas distintas —uno con `createUser(`, el otro
 * todavía con `inviteUserByEmail(`—, y eso es justo lo que el guard de censo trata
 * como «sender a medio migrar» y rechaza. La regla es buena (un fichero con las dos
 * llamadas manda DOS correos al invitado) y no se toca: lo que se separa es el
 * sender. `inviteBatch` se queda donde está y migrará el último, como estaba
 * previsto.
 *
 * Qué cambia para quien recibe el correo: antes lo mandaba GoTrue como efecto
 * secundario de `inviteUserByEmail`, con la plantilla única del dashboard de
 * Supabase, que no puede leer `profiles.locale` y salía SIEMPRE en castellano. Ahora
 * lo compone la app, en el idioma del destinatario si tiene perfil y en el de quien
 * invita si no.
 *
 * Y el que ya tiene cuenta deja de recibir un magic link: recibe el MISMO correo de
 * invitación que los demás (decisión de Correo-B1). El asunto ya no miente.
 *
 * El `createUser(` y el `inviteEmailMetadata(` se quedan A LA VISTA en este fichero
 * porque el guard de censo los cuenta aquí; ver la nota de `link-invited-user.ts`.
 */

export type TutorInviteResult = { ok: { email: string } } | { error: 'forbidden' | 'generic' };

/**
 * Envía —o RENUEVA— la invitación de tutor de un jugador.
 *
 * Anti-duplicado (sin cambios):
 *   1. Si ya hay una invitación VIGENTE (`accepted_at IS NULL` y no expirada) para
 *      el player, se RENUEVA (token nuevo + expiración +7d + email/relación del
 *      formulario) en vez de crear otra fila.
 *   2. Si no la hay, se INSERTA una nueva.
 *
 * El permiso lo impone la RLS de `invitations` (INSERT admin/director; UPDATE
 * admin_club) — si el actor no puede, devuelve 'forbidden'. Por eso los pasos 1 y 2
 * van con `supabase` (el cliente del usuario) y NUNCA con el de servicio.
 *
 * Y solo DESPUÉS, con la invitación ya creada, entra el cliente de servicio para la
 * cuenta y el correo.
 */
export async function sendOrRenewTutorInvitation(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  locale: string,
  params: {
    playerId: string;
    clubId: string;
    email: string;
    relation: 'parent' | 'guardian';
    createdBy: string;
  },
): Promise<TutorInviteResult> {
  const { playerId, clubId, email, relation, createdBy } = params;

  // 1) ¿Invitación de TUTOR vigente para este jugador? (no aceptada y no caducada)
  //
  // El filtro por rol y por relación NO es decorativo. En `invitations` conviven tres
  // clases de fila que llevan el MISMO `player_id`, y las tres las escribe gente
  // distinta:
  //
  //   · la de TUTOR    — role='jugador', relation 'parent'|'guardian' → esta;
  //   · la de SEGUIDOR — role='spectator', relation NULL, la crea la familia desde
  //     `invite_spectator` para el abuelo que solo mira;
  //   · la del MENOR   — role='jugador', relation='self', la crea el tutor desde
  //     `invite_player_self` para que su hijo tenga cuenta propia (MN-5).
  //
  // Sin filtrar, este `select` cogía la más reciente de las tres y la RENOVABA
  // pisándole el correo y la relación. Con la del seguidor el CHECK
  // `invitations_player_role_consistency` frenaba el desaguisado —un 'spectator' no
  // puede llevar relación— pero a cambio el botón de invitar al tutor devolvía un
  // error genérico que no explicaba nada. Con la del menor no frenaba NADA: la
  // invitación del hijo se convertía en la del padre, en silencio.
  //
  // La lista de relaciones es explícita (no un `neq('player_relation','self')`) para
  // que una relación nueva quede FUERA por defecto: crear una invitación de más se
  // ve; pisar la de otro, no.
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from('invitations')
    .select('id')
    .eq('player_id', playerId)
    .eq('role', 'jugador')
    .in('player_relation', ['parent', 'guardian'])
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let invite: { id: string; token: string } | null = null;

  if (existing?.id) {
    // 1a) Renovar la existente: token nuevo + +7d, y actualiza email/relación al
    //     último valor del formulario. NO crea una segunda fila.
    const renewedExpiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data: renewed, error: updErr } = await supabase
      .from('invitations')
      .update({
        email,
        player_relation: relation,
        token: crypto.randomUUID(),
        expires_at: renewedExpiry,
      })
      .eq('id', existing.id)
      .select('id, token')
      .single();
    if (updErr) {
      if (updErr.code === '42501') return { error: 'forbidden' };
      Sentry.captureException(updErr, {
        tags: { feature: 'invitations', step: 'renew_tutor' },
        extra: { player_id: playerId, invitation_id: existing.id },
      });
      return { error: 'generic' };
    }
    invite = renewed as { id: string; token: string };
  } else {
    // 1b) Sin invitación vigente → crear.
    const { data: inserted, error: insErr } = await supabase
      .from('invitations')
      .insert({
        email,
        role: 'jugador',
        club_id: clubId,
        player_id: playerId,
        player_relation: relation,
        created_by: createdBy,
      })
      .select('id, token')
      .single();
    if (insErr) {
      if (insErr.code === '42501') return { error: 'forbidden' };
      Sentry.captureException(insErr, {
        tags: { feature: 'invitations', step: 'insert_tutor' },
        extra: { player_id: playerId, relation },
      });
      return { error: 'generic' };
    }
    invite = inserted as { id: string; token: string };
  }

  if (!invite) return { error: 'generic' };

  // 2) El enlace del correo: directo a /invite/{token}, como siempre.
    // El enlace sale SIEMPRE de misterfc.es, no del host de la peticion: es el unico
  // dominio con assetlinks.json y AASA, y el unico que la app acepta. Ver WEB_ORIGIN.
  const redirectTo = inviteLink(locale, invite.token);

  const admin = createSupabaseAdminClient();

  // 3) ¿Quién hay detrás de ese correo? Antes de crear nada: decide si hay cuenta
  //    que crear, cuál enlazar y en qué idioma escribir. Si la búsqueda tropieza se
  //    sigue por el camino de "no tiene cuenta", que es el normal — y `createUser`
  //    dirá la verdad después si resulta que sí la tenía.
  let found: Awaited<ReturnType<ReturnType<typeof inviteRecipientPort>>> = null;
  try {
    found = await inviteRecipientPort(admin)(email);
  } catch (thrown) {
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'lookup_recipient_tutor' },
      extra: { invitation_id: invite.id },
    });
  }
  const emailLocale = found?.locale ?? locale;

  try {
    if (found && !found.invitePending) {
      // Cuenta suya de verdad: no se toca ni se enlaza. Acepta la invitación con su
      // propia sesión, y `invited_user_id` se queda como esté — no la creamos
      // nosotros, así que enrutarla a set_password le pediría cambiar su contraseña.
    } else if (found && found.invitePending) {
      // Cuenta que creamos en una invitación anterior y nadie reclamó. Se ENLAZA
      // ésa: sin esto, reenviar la invitación a un tutor deja al padre pidiéndole
      // una contraseña que nunca fijó — la trampa de agosto de 2026.
      const linkRes = await linkInvitedUser(admin, invite.id, found.userId, {
        feature: 'invitations',
        step: 'link_invited_user_tutor',
      });
      if (!linkRes.ok) return { error: 'generic' };
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        // Su correo ES su prueba. Sin esto GoTrue le niega el login al fijar la
        // contraseña en /invite (BUG-4).
        email_confirm: true,
        user_metadata: inviteEmailMetadata({
          invitationId: invite.id,
          kind: 'tutor',
          locale: emailLocale,
        }),
      });

      if (createErr) {
        if (isEmailAlreadyExistsError(createErr)) {
          // Carrera con la búsqueda de arriba (o una cuenta creada entremedias). La
          // invitación existe y el correo sale igual: se sigue.
          Sentry.captureMessage('[invitations] createUser: el correo ya tenía cuenta (tutor)', {
            level: 'warning',
            tags: { feature: 'invitations', step: 'create_race_tutor' },
            extra: { invitation_id: invite.id },
          });
        } else {
          Sentry.captureException(createErr, {
            tags: { feature: 'invitations', step: 'createUser_tutor' },
            extra: { invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
      } else {
        const invitedUserId = created?.user?.id ?? null;
        if (!invitedUserId) {
          // #535: creación OK pero sin user.id → antes MUDO. Sin invited_user_id la
          // invitación lleva a la trampa: ruidoso + error al admin para reintentar.
          Sentry.captureMessage('[invitations] createUser sin user.id (tutor)', {
            level: 'error',
            tags: { feature: 'invitations', step: 'invited_user_missing_id_tutor' },
            extra: { invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
        // Enlaza y EXIGE 1 fila afectada: un UPDATE de cero filas no da error en
        // PostgREST y dejaría invited_user_id NULL en silencio (raíz del incidente).
        const linkRes = await linkInvitedUser(admin, invite.id, invitedUserId, {
          feature: 'invitations',
          step: 'link_invited_user_tutor',
        });
        if (!linkRes.ok) return { error: 'generic' };
      }
    }
  } catch (thrown) {
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'createUser_tutor_thrown' },
      extra: { invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  // 4) El correo, LO ÚLTIMO. Si falla, la invitación queda creada y enlazada: volver
  //    a pulsar «invitar» en la ficha la RENUEVA y reenvía (paso 1a), no duplica.
  const { error: mailErr } = await invitationEmailPort('tutor')({
    to: email,
    url: redirectTo,
    locale: emailLocale,
  });
  if (mailErr) {
    Sentry.captureException(mailErr, {
      tags: { feature: 'invitations', step: 'send_invite_email_tutor' },
      extra: { invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  return { ok: { email } };
}
