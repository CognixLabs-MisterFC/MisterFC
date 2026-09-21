'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  STAFF_ROLES,
  inviteEmailMetadata,
  isEmailAlreadyExistsError,
  sendInvitationSchema,
  createSupabaseServerClient,
  createSupabaseAdminClient,
  type Role,
  inviteLink,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { linkInvitedUser } from '@/lib/link-invited-user';
import { invitationEmailPort, inviteRecipientPort } from '@/lib/email/invite-ports';

export type SendInvitationFormState = {
  error?: 'invalid_input' | 'forbidden' | 'no_club' | 'generic';
  ok?: { email: string };
  /**
   * BUG 3 · B-1 — el correo ya es de alguien del club: no se ha creado
   * invitación ni se ha mandado correo. `hasFicha` dice si esa persona tiene
   * ficha en Cuerpo técnico (la de un rol `jugador` no existe: es una familia).
   */
  existingMember?: {
    membershipId: string;
    fullName: string;
    clubRole: string;
    hasFicha: boolean;
  };
};

// Quién puede invitar (a roles bajos). director = admin en gestión de roles bajos.
// C-2b: el coordinador queda fuera de la invitación de club (su gestión de staff de
// sus equipos vive en Cuerpo técnico, C-2c; la RLS de invitations ya lo acota).
const ROLES_ALLOWED_TO_INVITE: Role[] = ['admin_club', 'director'];
// Roles "altos": invitarlos es EXCLUSIVO del owner del club (F1B-2). La RLS
// invitations_insert_admin lo impone; este check es el pre-gate server-side.
const HIGH_ROLES: Role[] = ['admin_club', 'director'];

/**
 * Devuelve un identificador del email seguro para logs (no PII completo).
 * Ej: "alice@example.com" → "al***@e***.com"
 */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'invalid';
  const [domainName, ...tld] = domain.split('.');
  return `${user.slice(0, 2)}***@${(domainName ?? '').slice(0, 1)}***${tld.length ? '.' + tld.join('.') : ''}`;
}

/**
 * Server Action: crea la invitación de alguien del club y le manda su correo.
 *
 * Flujo (ADR-0004 — auth por email+password):
 *  1. Validar permisos del actor (admin_club o director del club; los roles
 *     altos, solo el owner).
 *  2. RENOVAR la invitación pendiente de ese correo en ese club, si la hay, o
 *     INSERTAR una nueva. A una persona se la invita UNA vez, con UN rol.
 *  3. Correo-B5 — buscar al destinatario, crear su cuenta con `createUser` si no
 *     la tiene, ENLAZAR `invited_user_id` y mandarle el correo por Resend, EN SU
 *     IDIOMA. Antes eran una sola llamada (`inviteUserByEmail`) y la plantilla
 *     única del dashboard, que sale siempre en castellano.
 *  4. `user_metadata.invite_pending=true` (lo pone `inviteEmailMetadata`) para
 *     que /invite muestre el form de contraseña.
 *
 * El orden importa: la cuenta y el enlazado ANTES del correo. Si el correo falla
 * queda una invitación válida que se puede cancelar y rehacer; si fallara al
 * revés, el invitado tendría un enlace que no lleva a ninguna parte.
 */
export async function sendInvitation(
  locale: string,
  _prev: SendInvitationFormState,
  formData: FormData,
): Promise<SendInvitationFormState> {
  const teamIdRaw = formData.get('team_id');
  const parsed = sendInvitationSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    team_id: teamIdRaw && String(teamIdRaw).length > 0 ? teamIdRaw : null,
  });
  if (!parsed.success) {
    console.error('[invitations] invalid_input', {
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        code: i.code,
        message: i.message,
      })),
    });
    return { error: 'invalid_input' };
  }

  const maskedEmail = maskEmail(parsed.data.email);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  // Paso 1: memberships del actor.
  const { data: memberships, error: mErr } = await supabase
    .from('memberships')
    .select('id, club_id, role')
    .eq('profile_id', user.id);

  if (mErr) {
    console.error('[invitations] read_memberships_failed', {
      step: 'read_memberships',
      code: mErr.code,
      message: mErr.message,
      details: mErr.details,
      hint: mErr.hint,
    });
    Sentry.captureException(mErr, {
      tags: { feature: 'invitations', step: 'read_memberships' },
      extra: { user_id: user.id },
    });
    return { error: 'no_club' };
  }
  if (!memberships || memberships.length === 0) {
    console.warn('[invitations] no_memberships_found', { user_id: user.id });
    return { error: 'no_club' };
  }

  const authorized = memberships.find((m) => ROLES_ALLOWED_TO_INVITE.includes(m.role as Role));
  if (!authorized) {
    console.warn('[invitations] forbidden_role', {
      user_id: user.id,
      roles: memberships.map((m) => m.role),
    });
    return { error: 'forbidden' };
  }

  // F1B-2: invitar con un rol ALTO (admin_club/director) es exclusivo del owner
  // del club. Pre-gate server-side (la RLS invitations_insert_admin lo reimpone).
  if (HIGH_ROLES.includes(parsed.data.role as Role)) {
    const { data: club } = await supabase
      .from('clubs')
      .select('owner_profile_id')
      .eq('id', authorized.club_id)
      .single();
    if (!club || club.owner_profile_id !== user.id) {
      console.warn('[invitations] forbidden_high_role_requires_owner', {
        user_id: user.id,
        role: parsed.data.role,
      });
      return { error: 'forbidden' };
    }
  }

  // BUG 3 · B-1 — antes de crear nada, preguntamos si ese correo ya es de
  // alguien del club. Si lo es, la invitación no sirve para NADA, y el problema
  // no es solo que el correo salga con asunto de contraseña:
  //
  //   accept_pending_invitations → insert into memberships ...
  //     on conflict (profile_id, club_id) do update set role = case
  //       when memberships.left_at is not null then excluded.role
  //       else memberships.role end
  //
  // A un miembro ACTIVO la invitación NO le cambia el rol. Invitar a quien ya
  // está dentro «para ascenderlo» mandaba un correo y no hacía nada: la pantalla
  // prometía algo que no ocurría. Ahora se dice quién es y con qué rol.
  //
  // Quien está DE BAJA no cuenta como miembro (la RPC filtra `left_at is null`)
  // y su invitación sigue su curso: es justo la que le reincorpora, porque en
  // ese caso el CASE de arriba SÍ adopta el rol nuevo.
  //
  // Va ANTES del INSERT, y esa es la diferencia con el alta de jugador (#646):
  // allí el jugador se crea igual porque el jugador ERA el objetivo; aquí el
  // objetivo era la invitación, así que no dejamos ni la fila.
  //
  // Si la RPC falla —permisos, red—, se sigue por el camino de siempre: se
  // invita. La pantalla no se queda muerta por un fallo del atajo.
  const { data: memberRows, error: memberErr } = await supabase.rpc(
    'club_member_by_email',
    { p_club_id: authorized.club_id, p_email: parsed.data.email },
  );
  if (memberErr) {
    console.error(
      '[invitations] member_lookup_failed ' +
        JSON.stringify({ masked_email: maskedEmail, error: memberErr.message }),
    );
    Sentry.captureException(memberErr, {
      tags: { feature: 'invitations', step: 'send_invitation_member_lookup' },
      extra: { club_id: authorized.club_id, masked_email: maskedEmail },
    });
  }
  const existing = memberErr ? null : (memberRows ?? [])[0];
  if (existing) {
    console.info('[invitations] already_member_not_invited', {
      masked_email: maskedEmail,
      member_role: existing.role,
      requested_role: parsed.data.role,
    });
    return {
      existingMember: {
        membershipId: existing.membership_id,
        fullName: existing.full_name ?? '—',
        clubRole: existing.role,
        hasFicha: STAFF_ROLES.includes(existing.role as Role),
      },
    };
  }

  // Paso 2: la invitación. RENOVAR si ya hay una pendiente para este correo en este
  // club; si no, crearla.
  //
  // REGLA DE PRODUCTO: a una persona se la invita UNA vez, con UN rol. Los demás
  // roles se le añaden después desde dentro (agregar rol, agregar jugador). Antes,
  // reinvitar al mismo correo creaba una fila más: dos enlaces vivos para la misma
  // persona y la lista de pendientes con la misma dirección repetida.
  //
  // Si la pendiente es de OTRO rol, se PISA con el del formulario: nadie ha aceptado
  // nada todavía, así que no se pierde nada, y el caso real es una corrección ("me
  // equivoqué de rol"). El pre-gate de rol alto (F1B-2, más arriba) ya ha corrido, así
  // que por aquí no se asciende a nadie a admin_club/director sin ser el owner.
  //
  // ── El alcance lleva `player_id is null`, y NO es un detalle ────────────────────
  // El circuito de tutor (lib/invite-tutor.ts) escribe en esta MISMA tabla con
  // `role='jugador'` y un `player_id`. Sin ese filtro, invitar como delegada a una
  // madre que tiene pendiente la invitación que la vincula a su hijo renovaría ESA
  // fila y le pisaría el `player_id` y la relación — lo único que crea el vínculo
  // familiar al aceptar. Aquí solo se tocan invitaciones DE CLUB.
  //
  // Una pendiente CADUCADA no se renueva: se crea otra, igual que hace el circuito de
  // tutor. La caducada se queda hasta que alguien la borre; no estorba porque ya no
  // vale como enlace.
  const ahoraIso = new Date().toISOString();
  const { data: pendientes, error: pendErr } = await supabase
    .from('invitations')
    .select('id, email, role')
    .eq('club_id', authorized.club_id)
    .is('player_id', null)
    .is('accepted_at', null)
    .gt('expires_at', ahoraIso)
    .order('created_at', { ascending: false });

  if (pendErr) {
    console.error(
      '[invitations] pending_lookup_failed ' +
        JSON.stringify({
          step: 'pending_lookup',
          masked_email: maskedEmail,
          code: pendErr.code,
          message: pendErr.message,
        }),
    );
    Sentry.captureException(pendErr, {
      tags: { feature: 'invitations', step: 'pending_lookup' },
      extra: { club_id: authorized.club_id, masked_email: maskedEmail },
    });
    return { error: 'generic' };
  }

  // La comparación va en JS y en minúsculas a propósito. `invitations.email` guarda lo
  // que se escribió (el schema hace trim, no lower), así que un `.eq` se dejaría
  // "Ana@club.es" frente a "ana@club.es" y crearía justo el duplicado que esto evita.
  // Y no se usa `ilike` porque `_` y `%` son comodines suyos y un correo puede llevar
  // un `_` (pepe_ruiz@club.es casaría con pepeXruiz@club.es).
  const buscado = parsed.data.email.trim().toLowerCase();
  const pendiente =
    (pendientes ?? []).find((p) => (p.email ?? '').trim().toLowerCase() === buscado) ?? null;

  let invite: { id: string; token: string } | null = null;

  if (pendiente) {
    // Renovación: token nuevo (el anterior deja de valer), +7 días, y el rol y el
    // equipo del formulario. Si quedaran duplicados de ANTES de esta regla, se renueva
    // la más reciente y las otras siguen su curso hasta caducar.
    const nuevaExpiracion = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data: renovada, error: updErr } = await supabase
      .from('invitations')
      .update({
        role: parsed.data.role,
        team_id: parsed.data.team_id ?? null,
        token: crypto.randomUUID(),
        expires_at: nuevaExpiracion,
      })
      .eq('id', pendiente.id)
      .select('id, token')
      .single();

    if (updErr) {
      console.error(
        '[invitations] renew_failed ' +
          JSON.stringify({
            step: 'renew_invitation',
            masked_email: maskedEmail,
            invitation_id: pendiente.id,
            code: updErr.code,
            message: updErr.message,
          }),
      );
      if (updErr.code === '42501') return { error: 'forbidden' };
      Sentry.captureException(updErr, {
        tags: {
          feature: 'invitations',
          step: 'renew_invitation',
          pg_code: updErr.code ?? 'unknown',
        },
        extra: {
          club_id: authorized.club_id,
          role: parsed.data.role,
          masked_email: maskedEmail,
        },
      });
      return { error: 'generic' };
    }
    invite = renovada as { id: string; token: string } | null;

    if (invite) {
      console.info('[invitations] renewed', {
        invitation_id: invite.id,
        rol_anterior: pendiente.role,
        role: parsed.data.role,
        masked_email: maskedEmail,
      });
    }
  } else {
    const insertPayload = {
      email: parsed.data.email,
      role: parsed.data.role,
      club_id: authorized.club_id,
      team_id: parsed.data.team_id ?? null,
      created_by: user.id,
    };

    const { data: insertada, error: insErr } = await supabase
      .from('invitations')
      .insert(insertPayload)
      .select('id, token')
      .single();

    if (insErr) {
      console.error('[invitations] insert_failed', {
        step: 'insert_invitation',
        code: insErr.code,
        message: insErr.message,
        details: insErr.details,
        hint: insErr.hint,
        payload: { ...insertPayload, email: maskedEmail },
      });
      Sentry.captureException(insErr, {
        tags: {
          feature: 'invitations',
          step: 'insert_invitation',
          pg_code: insErr.code ?? 'unknown',
        },
        extra: {
          club_id: authorized.club_id,
          role: parsed.data.role,
          team_id: parsed.data.team_id ?? null,
          masked_email: maskedEmail,
        },
      });
      return { error: 'generic' };
    }
    invite = insertada as { id: string; token: string } | null;

    if (invite) {
      console.info('[invitations] inserted', {
        invitation_id: invite.id,
        role: parsed.data.role,
        masked_email: maskedEmail,
      });
    }
  }

  if (!invite) {
    console.error('[invitations] invitation_returned_null');
    Sentry.captureMessage('[invitations] insert/update devolvió null sin error', {
      level: 'error',
      tags: { feature: 'invitations', step: 'insert_invitation' },
    });
    return { error: 'generic' };
  }

  // Paso 3: la cuenta y el correo.
  //
  // Correo-B5 — antes esto era UNA llamada, `inviteUserByEmail`, que creaba la
  // cuenta Y mandaba el correo con la plantilla única del dashboard de Supabase.
  // Esa plantilla no puede leer `profiles.locale`: al entrenador que tiene la app
  // en valenciano le llegaba igualmente en castellano. Ahora son dos pasos —la
  // cuenta con `createUser`, que no manda nada, y el correo por Resend— y el
  // idioma lo decide el sender.
  // redirectTo apunta directamente a la página de invitación, que intercambia el
  // token por sesión. Antes pasábamos por /auth/callback, pero si la URL no
  // estaba en la allowlist de Supabase caía en silencio al Site URL (la raíz) y
  // el code se perdía.
  // El enlace sale SIEMPRE de misterfc.es, no del host de la peticion: es el unico
  // dominio con assetlinks.json y AASA, y el unico que la app acepta. Ver WEB_ORIGIN.
  const redirectTo = inviteLink(locale, invite.token);

  console.info('[invitations][invite-email] sending', {
    masked_email: maskedEmail,
    invitation_id: invite.id,
    redirectTo,
  });

  const admin = createSupabaseAdminClient();

  /**
   * Serializa un error del SDK Supabase (o cualquier objeto error-like) a un
   * objeto plano para console.error.
   *
   * Logueamos a console.error con un objeto JSON-stringificable porque Vercel
   * runtime logs no rinden bien objetos anidados; pasar string asegura que
   * todos los campos llegan en una línea grepable.
   *
   * NUNCA depender solo de Sentry.captureException — históricamente Sentry
   * ha estado roto en este proyecto y el único registro del error eran los
   * console.* en Vercel. Ver `docs/journey/known-issues.md`.
   */
  function serializeError(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      const anyErr = err as Error & {
        status?: number;
        code?: string;
        details?: unknown;
        hint?: unknown;
      };
      return {
        name: err.name,
        message: err.message,
        status: anyErr.status,
        code: anyErr.code,
        details: anyErr.details,
        hint: anyErr.hint,
        stack: err.stack,
      };
    }
    if (typeof err === 'object' && err !== null) {
      try {
        return JSON.parse(JSON.stringify(err));
      } catch {
        return { repr: String(err) };
      }
    }
    return { repr: String(err) };
  }

  // ¿Ya tiene cuenta este correo? Antes de crear nada: decide si hay cuenta que
  // crear, cuál enlazar y en qué IDIOMA escribir. Si la búsqueda tropieza se sigue
  // por el camino de "no tiene cuenta", que es el normal, y `createUser` dirá la
  // verdad después si resulta que sí la tenía.
  let found: Awaited<ReturnType<ReturnType<typeof inviteRecipientPort>>> = null;
  try {
    found = await inviteRecipientPort(admin)(parsed.data.email);
  } catch (thrown) {
    console.error(
      '[invitations][invite-email] lookup_failed ' +
        JSON.stringify({
          step: 'lookup_recipient',
          masked_email: maskedEmail,
          invitation_id: invite.id,
          error: serializeError(thrown),
        }),
    );
  }
  const emailLocale = found?.locale ?? locale;

  try {
    if (found && !found.invitePending) {
      // Cuenta suya de verdad: no se toca ni se enlaza. Acepta con su propia
      // sesión, y `invited_user_id` se queda NULL a propósito — enrutarla a
      // set_password le pediría cambiar una contraseña que ya tiene.
      console.info('[invitations][invite-email] cuenta_existente', {
        masked_email: maskedEmail,
        invitation_id: invite.id,
      });
    } else if (found && found.invitePending) {
      // Cuenta que creamos en una invitación anterior y nadie reclamó: se ENLAZA
      // ésa. Sin esto, reinvitar a la misma persona la deja pidiéndole una
      // contraseña que nunca fijó — la trampa de agosto de 2026.
      const linkRes = await linkInvitedUser(admin, invite.id, found.userId, {
        feature: 'invitations',
        step: 'link_invited_user',
        maskedEmail,
      });
      if (!linkRes.ok) return { error: 'generic' };
      console.info('[invitations][invite-email] invited_user_linked', {
        masked_email: maskedEmail,
        invitation_id: invite.id,
      });
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: parsed.data.email,
        // Su correo ES su prueba. Sin esto GoTrue le niega el login al fijar la
        // contraseña en /invite (BUG-4).
        email_confirm: true,
        user_metadata: inviteEmailMetadata({
          invitationId: invite.id,
          kind: 'staff',
          locale: emailLocale,
        }),
      });

      if (createErr) {
        if (isEmailAlreadyExistsError(createErr)) {
          // Carrera con la búsqueda de arriba (o cuenta creada entremedias). La
          // invitación existe y el correo sale igual: se sigue.
          console.info('[invitations][invite-email] create_race', {
            masked_email: maskedEmail,
            invitation_id: invite.id,
            original_error: serializeError(createErr),
          });
        } else {
          console.error(
            '[invitations][invite-email] create_returned_error ' +
              JSON.stringify({
                step: 'createUser',
                masked_email: maskedEmail,
                invitation_id: invite.id,
                error: serializeError(createErr),
              }),
          );
          Sentry.captureException(createErr, {
            tags: {
              feature: 'invitations',
              step: 'createUser',
              invite_status: String((createErr as { status?: number }).status ?? 'unknown'),
            },
            extra: { masked_email: maskedEmail, invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
      } else {
        const invitedUserId = created?.user?.id ?? null;
        if (!invitedUserId) {
          // Creación OK pero SIN user.id: no es normal (antes era MUDO). Sin
          // invited_user_id la invitación lleva a "inicia sesión" sobre una cuenta
          // sin contraseña (la trampa). Ruidoso y error al admin para que
          // reintente, en vez de dar por buena una invitación rota.
          console.error(
            '[invitations][invite-email] invited_user_missing_id ' +
              JSON.stringify({
                step: 'invited_user_missing_id',
                masked_email: maskedEmail,
                invitation_id: invite.id,
              }),
          );
          Sentry.captureMessage('[invitations] createUser sin user.id', {
            level: 'error',
            tags: { feature: 'invitations', step: 'invited_user_missing_id' },
            extra: { masked_email: maskedEmail, invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
        // Enlaza y EXIGE 1 fila afectada: un UPDATE de cero filas no da error en
        // PostgREST y dejaría invited_user_id NULL en silencio (raíz del incidente).
        const linkRes = await linkInvitedUser(admin, invite.id, invitedUserId, {
          feature: 'invitations',
          step: 'link_invited_user',
          maskedEmail,
        });
        if (!linkRes.ok) return { error: 'generic' };
        console.info('[invitations][invite-email] invited_user_linked', {
          masked_email: maskedEmail,
          invitation_id: invite.id,
        });
      }
    }
  } catch (thrown) {
    console.error(
      '[invitations][invite-email] create_thrown ' +
        JSON.stringify({
          step: 'createUser',
          masked_email: maskedEmail,
          invitation_id: invite.id,
          error: serializeError(thrown),
        }),
    );
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'createUser_thrown' },
      extra: { masked_email: maskedEmail, invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  // El correo, LO ÚLTIMO. Si falla, la invitación queda creada y enlazada: se
  // cancela y se vuelve a invitar desde la misma pantalla.
  const { error: mailErr } = await invitationEmailPort('staff')({
    to: parsed.data.email,
    url: redirectTo,
    locale: emailLocale,
    // El PAPEL con el que se invita. Esta pantalla no invita solo a cuerpo técnico:
    // también nombra administrador del club, dirección, coordinación o familia, y el
    // correo lo dice. Con la plantilla de GoTrue los seis recibían el mismo texto.
    role: parsed.data.role,
  });
  if (mailErr) {
    console.error(
      '[invitations][invite-email] email_failed ' +
        JSON.stringify({
          step: 'send_invite_email',
          masked_email: maskedEmail,
          invitation_id: invite.id,
          error: serializeError(mailErr),
        }),
    );
    Sentry.captureException(mailErr, {
      tags: { feature: 'invitations', step: 'send_invite_email' },
      extra: { masked_email: maskedEmail, invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  console.info('[invitations][invite-email] sent', {
    masked_email: maskedEmail,
    invitation_id: invite.id,
  });

  // Paso 4: si el rol es entrenador_ayudante, las capabilities se sembrarán al
  // crearse la membership en /invite/{token} (trigger ensure_assistant_capabilities).
  if (parsed.data.role === 'entrenador_ayudante') {
    console.info('[invitations] assistant_role_invited_capabilities_will_seed_on_accept', {
      invitation_id: invite.id,
    });
  }

  revalidatePath(`/${locale}/invitations`);
  return { ok: { email: parsed.data.email } };
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelInvitation — F2.6 hotfix 2026-05-30
// ─────────────────────────────────────────────────────────────────────────────

export type CancelInvitationResult = {
  ok?: { email: string };
  error?: 'not_found' | 'already_accepted' | 'forbidden' | 'generic';
};

/**
 * Borra una invitación pendiente o expirada. Permisos delegados al policy RLS
 * `invitations_delete_managers` (inviter + admin/coord del club + principal
 * del team referenciado). El server verifica además que `accepted_at IS NULL`
 * para impedir borrar invitaciones ya aceptadas — esas generaron memberships
 * reales y el camino para revocar acceso es removeStaff / removeFamilyLink.
 *
 * Revalida la vista correcta según la invitación:
 *   - club-level → /invitations
 *   - team-level (team_id) → /equipos/[teamId]
 *   - player-level (player_id) → /jugadores/[playerId]
 *
 * El cliente borra optimista la fila en su lista; si el server devuelve error,
 * vuelve a mostrarla.
 */
export async function cancelInvitation(
  locale: string,
  invitationId: string,
): Promise<CancelInvitationResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // SELECT primero para validar estado y poder revalidar paths correctos.
  // RLS de SELECT ya filtra invitaciones que el user no debería ver; si vuelve
  // null lo tratamos como not_found (no leakeamos existencia).
  const { data: invite, error: selErr } = await supabase
    .from('invitations')
    .select('id, email, accepted_at, team_id, player_id, club_id')
    .eq('id', invitationId)
    .maybeSingle();

  if (selErr) {
    Sentry.captureException(selErr, {
      tags: { feature: 'invitations', step: 'cancel_select' },
      extra: { invitation_id: invitationId },
    });
    return { error: 'generic' };
  }
  if (!invite) return { error: 'not_found' };

  if (invite.accepted_at) return { error: 'already_accepted' };

  const { error: delErr, count } = await supabase
    .from('invitations')
    .delete({ count: 'exact' })
    .eq('id', invitationId);

  if (delErr) {
    // 42501 = insufficient privilege — el RLS rechazó al user. No es genérico.
    if (delErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(delErr, {
      tags: { feature: 'invitations', step: 'cancel_delete' },
      extra: { invitation_id: invitationId },
    });
    return { error: 'generic' };
  }
  // Sin error pero count=0: RLS dejó pasar el query pero ningún row matchea
  // (puede ser una race con un cancel simultáneo). Lo tratamos como forbidden
  // para no engañar al cliente con un "ok" falso.
  if (count === 0) return { error: 'forbidden' };

  console.info('[invitations] cancelled', {
    invitation_id: invitationId,
    masked_email: maskEmail(invite.email),
  });

  // Revalidar todas las rutas donde esta invitación pudiera estar listada.
  // Incluye el nivel 2 anidado (su fila desaparece) y el nivel 1 (resumen coherente).
  revalidatePath(`/${locale}/invitations`);
  revalidatePath(`/${locale}/invitations/${invite.team_id ?? 'sin-equipo'}`);
  if (invite.team_id) revalidatePath(`/${locale}/equipos/${invite.team_id}`);
  if (invite.player_id) revalidatePath(`/${locale}/jugadores/${invite.player_id}`);
  // La PLANTILLA (lista) cuenta los jugadores PENDIENTES DE INVITAR
  // (`loadPendingInvitePlayers`): al cancelar, el jugador vuelve a esa cuenta.
  // Revalidarla para que se vea sin recargar. Convención de jugadores/actions.ts.
  // (El marcador "Sin app" ya no depende de las invitaciones: solo de
  // `player_accounts`, que cancelar no toca.)
  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');

  return { ok: { email: invite.email } };
}
