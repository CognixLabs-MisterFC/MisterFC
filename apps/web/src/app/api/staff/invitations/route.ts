/**
 * W-6 — Endpoint "invitar al club" para la app nativa: da de alta a alguien que NO
 * está dentro, con su rol, y le manda su correo en su idioma.
 *
 * La app llama con `Authorization: Bearer <access token>`. Réplica de la Server Action
 * `sendInvitation`, compartiendo el flujo entero (`performStaffInvite`) — no hay una
 * segunda implementación de nada, y la regla `covered` sigue siendo `pendingCoversEmail`
 * y solo esa.
 *
 * ── POR QUÉ ESTA PIEZA SÍ LLEVA ENDPOINT ───────────────────────────────────
 * Es la única de la serie W que lo necesita. W-2 y W-3 escriben `team_staff`, W-4 llama
 * dos RPC y W-5 escribe `player_accounts`: en los tres casos el gate es la RLS y la app
 * puede hacerlo con su propia sesión. Aquí hay que CREAR la cuenta del invitado y
 * ENLAZARLA (`admin.auth.admin.createUser` + `invited_user_id`), y eso exige la
 * service-role, que jamás puede vivir en un teléfono.
 *
 * ── ORDEN DE SEGURIDAD (invariante) ────────────────────────────────────────
 *   1. `resolveUserFromRequest` valida el bearer (getUser) → 401 si no vale. El
 *      cliente que devuelve es RLS-scoped al usuario, NUNCA admin.
 *   2. El permiso y la FILA de invitación se escriben con ESE cliente, así que pasan
 *      por `invitations_insert_admin`: `role <> 'spectator'` y, según el rol pedido,
 *      `user_is_club_owner(club_id)` o `user_role_in_club(club_id) in
 *      ('admin_club','director')`. Ese es el gate.
 *   3. El ADMIN aparece DESPUÉS, y solo para la cuenta y el correo.
 *
 * Si alguien adelantara el admin al paso 2, la invitación se crearía sin permiso y
 * NADA fallaría. Ese orden tiene test en core (`staff-invite.test.ts`).
 *
 * Respuestas: 200 {status:'ok', email, covered} · 200 {status:'existing_member', …}
 * cuando ese correo YA es de alguien del club (no se crea invitación ni sale correo) ·
 * 401 unauthorized · 400 invalid|email_invalid|role_invalid · 403 forbidden ·
 * 500 generic.
 *
 * Sin CORS: la app nativa no es un navegador y no dispara preflight. El único
 * requisito de acceso es un bearer válido.
 */

import { NextResponse } from 'next/server';
import {
  createSupabaseAdminClient,
  inviteLinkBase,
  sendInvitationSchema,
  type StaffInviteError,
} from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { performStaffInvite } from '@/lib/invite-staff';

export const runtime = 'nodejs';

const LOCALE_RE = /^[a-z]{2}$/;

/** Mismo reparto de códigos que la web, traducido a HTTP. */
const STATUS: Record<StaffInviteError, number> = {
  invalid_input: 400,
  forbidden: 403,
  no_club: 403,
  generic: 500,
};

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const b = (body ?? {}) as {
    email?: unknown;
    role?: unknown;
    teamId?: unknown;
    locale?: unknown;
  };

  // El MISMO schema que la web: el correo y el rol se validan una sola vez en un solo
  // sitio. Se distingue cuál de los dos falló porque la app enseña textos distintos.
  const parsed = sendInvitationSchema.safeParse({
    email: b.email,
    role: b.role,
    team_id: typeof b.teamId === 'string' && b.teamId.length > 0 ? b.teamId : null,
  });
  if (!parsed.success) {
    const campo = parsed.error.issues[0]?.path[0];
    const code =
      campo === 'email' ? 'email_invalid' : campo === 'role' ? 'role_invalid' : 'invalid';
    return NextResponse.json({ error: code }, { status: 400 });
  }

  const locale =
    typeof b.locale === 'string' && LOCALE_RE.test(b.locale) ? b.locale : 'es';

  // El gate es la RLS del INSERT, que corre con `auth.supabase` (el cliente del
  // usuario). El admin solo se usa para la cuenta y el correo, DESPUÉS.
  const res = await performStaffInvite(auth.supabase, createSupabaseAdminClient(), {
    actorProfileId: auth.user.id,
    email: parsed.data.email,
    role: parsed.data.role,
    teamId: parsed.data.team_id ?? null,
    locale,
    // El enlace sale SIEMPRE de misterfc.es, no del host de la petición: es el único
    // dominio con assetlinks.json y AASA, y el único que la app acepta. Ver WEB_ORIGIN.
    linkBase: inviteLinkBase(locale),
  });

  if (res.existingMember) {
    return NextResponse.json({
      status: 'existing_member',
      member: res.existingMember,
    });
  }
  if (res.error) {
    return NextResponse.json({ error: res.error }, { status: STATUS[res.error] });
  }

  return NextResponse.json({
    status: 'ok',
    email: res.ok.email,
    covered: res.ok.covered,
  });
}
