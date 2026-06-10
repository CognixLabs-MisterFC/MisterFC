import {
  createSupabaseAdminClient,
  assertInvitationValid,
  type InvitationVerdict,
} from '@misterfc/core';

/**
 * Carga de la invitación por token — Rework B · B2.
 *
 * ⚠️ Server-only. Usa el cliente service_role (bypass RLS) a propósito: el flujo
 * /invite/{token} NO requiere sesión previa, así que el rol `authenticated` no
 * existe todavía y el policy `invitations_select_admin_or_invited` no aplicaría.
 * El TOKEN es la credencial: quien lo posee puede leer la invitación que designa.
 *
 * Devolvemos solo los campos necesarios para pintar la página y ejecutar el
 * accept. El `invited_user_id` distingue invitee nuevo (cuenta creada por
 * nosotros, no reclamada) de invitee existente (NULL → debe iniciar sesión).
 *
 * Importado por `page.tsx` (Server Component) y por `actions.ts` (Server
 * Actions). No es una Server Action: es un helper de datos puro server-side.
 */

export type LoadedInvitation = {
  id: string;
  token: string;
  email: string;
  role: string;
  club_id: string;
  club_name: string | null;
  accepted_at: string | null;
  expires_at: string;
  player_id: string | null;
  player_relation: string | null;
  team_id: string | null;
  team_staff_role: string | null;
  invited_user_id: string | null;
};

export async function loadInvitationByToken(
  token: string
): Promise<LoadedInvitation | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('invitations')
    .select(
      'id, token, email, role, club_id, accepted_at, expires_at, player_id, player_relation, team_id, team_staff_role, invited_user_id, club:club_id(name)'
    )
    .eq('token', token)
    .maybeSingle<RawRow>();

  if (error || !data) return null;

  return mapRow(data);
}

type RawRow = {
  id: string;
  token: string;
  email: string;
  role: string;
  club_id: string;
  accepted_at: string | null;
  expires_at: string;
  player_id: string | null;
  player_relation: string | null;
  team_id: string | null;
  team_staff_role: string | null;
  invited_user_id: string | null;
  club: { name: string } | null;
};

function mapRow(data: RawRow): LoadedInvitation {
  return {
    id: data.id,
    token: data.token,
    email: data.email,
    role: data.role,
    club_id: data.club_id,
    club_name: data.club?.name ?? null,
    accepted_at: data.accepted_at,
    expires_at: data.expires_at,
    player_id: data.player_id,
    player_relation: data.player_relation,
    team_id: data.team_id,
    team_staff_role: data.team_staff_role,
    invited_user_id: data.invited_user_id,
  };
}

/**
 * Carga + valida la invitación para la página. Calcula el verdict aquí (módulo
 * server-only, no en el render del Server Component) para no invocar `Date.now()`
 * durante render — el React Compiler lo marca como impuro.
 */
export async function loadInvitationForPage(token: string): Promise<{
  invitation: LoadedInvitation | null;
  verdict: InvitationVerdict;
}> {
  const invitation = await loadInvitationByToken(token);
  return { invitation, verdict: assertInvitationValid(invitation, Date.now()) };
}
