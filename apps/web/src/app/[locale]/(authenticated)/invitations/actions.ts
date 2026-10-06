'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  sendInvitationSchema,
  createSupabaseServerClient,
  createSupabaseAdminClient,
  inviteLinkBase,
  type StaffInviteError,
  type StaffInviteExistingMember,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { performStaffInvite } from '@/lib/invite-staff';
import { loadShellContext } from '@/lib/auth-shell';
import { maskEmail } from '@/lib/mask-email';

export type SendInvitationFormState = {
  /** Los mismos desenlaces que `performStaffInvite`, más el del formulario. */
  error?: StaffInviteError;
  ok?: {
    email: string;
    /**
     * No salió correo: ese correo ya tenía una invitación pendiente vigente en el
     * club y su enlace cubre también a esta. A una persona se le escribe una vez.
     */
    covered: boolean;
  };
  /**
   * BUG 3 · B-1 — el correo ya es de alguien del club: no se ha creado
   * invitación ni se ha mandado correo. `hasFicha` dice si esa persona tiene
   * ficha en Cuerpo técnico (la de un rol `jugador` no existe: es una familia).
   */
  existingMember?: StaffInviteExistingMember;
};

/**
 * Server Action: crea la invitación de alguien que NO está en el club y le manda su
 * correo, en su idioma.
 *
 * W-6 — el flujo entero vive en core (`performStaffInvite`, vía el envoltorio
 * `@/lib/invite-staff` que inyecta Sentry, el enlazado, el correo y la búsqueda del
 * destinatario). Aquí queda LO QUE ES DE LA WEB: el FormData, el idioma de la ruta y
 * qué páginas revalidar. Eran 763 líneas que ningún test ejecutaba.
 *
 * Lo pide también la app nativa (`/api/staff/invitations`), y es la única pieza de la
 * serie que NECESITA endpoint: crear y enlazar la cuenta del invitado exige la
 * service-role. El gate sigue siendo la RLS, porque la FILA se escribe con el cliente
 * del usuario y el admin entra después. Ese orden está probado en core.
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

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  // El enlace sale SIEMPRE de misterfc.es, no del host de la petición: es el único
  // dominio con assetlinks.json y AASA, y el único que la app acepta. Ver WEB_ORIGIN.
  // El club es el ACTIVO, el mismo que pinta la pantalla. Antes no se pasaba y core
  // lo adivinaba con «el primer club donde puedo invitar» (y sin `order by`), así
  // que la invitación podía nacer en otro club y el correo nombrarlo. Mismo fallo
  // que arreglaron las dos pantallas en #755, aquí ESCRIBIENDO.
  //
  // `loadShellContext` y no `resolveActiveClub` a pelo: para un superadmin en club
  // ajeno ese club no está en sus membresías y es el shell quien fabrica el club
  // sintético (F14B-8).
  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const res = await performStaffInvite(supabase, createSupabaseAdminClient(), {
    actorProfileId: user.id,
    clubId: ctx.activeClub.club.id,
    email: parsed.data.email,
    role: parsed.data.role,
    teamId: parsed.data.team_id ?? null,
    locale,
    linkBase: inviteLinkBase(locale),
  });

  if (res.existingMember) return { existingMember: res.existingMember };
  if (res.error) return { error: res.error };

  // Paso 4: si el rol es entrenador_ayudante, las capabilities se siembran al crearse
  // la membership en /invite/{token} (trigger ensure_assistant_capabilities).
  revalidatePath(`/${locale}/invitations`);
  return { ok: res.ok };
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
