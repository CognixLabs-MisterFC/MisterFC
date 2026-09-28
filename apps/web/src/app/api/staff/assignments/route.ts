/**
 * W-2 — Endpoint "agregar rol": da una función en un equipo a alguien que YA está en
 * el club, para la app nativa.
 *
 * La app no tiene cookie ni service-role: llama con `Authorization: Bearer <access
 * token de Supabase>`. Réplica de la Server Action `addStaffAssignment` de
 * `cuerpo-tecnico/actions.ts`, compartiendo la escritura en core (`assignStaffToTeam`,
 * bajada en W-1) — no hay una segunda implementación de la regla.
 *
 * Orden de seguridad (invariante):
 *   1. `resolveUserFromRequest` valida el bearer (getUser) → 401 si no vale. El
 *      cliente que devuelve es RLS-scoped al usuario, NUNCA admin.
 *   2. `assignStaffToTeam` corre con ESE cliente, así que el INSERT pasa por
 *      `team_staff_insert_admin`. Ese es el gate.
 *
 * Aquí NO se recomprueba el permiso, y es deliberado: la Server Action de la web
 * tampoco lo hace. Quien decide es la RLS, y `staffAssignmentPermission` (core) solo
 * sirve para no OFRECER lo que el servidor va a rechazar. Un segundo candado aquí
 * sería una tercera copia de la regla, con otra oportunidad de divergir.
 *
 * No se usa el service-role en ningún momento: esta escritura no lo necesita.
 *
 * Respuestas: 200 {status:'ok'} · 401 unauthorized · 400 invalid|team_invalid|
 * staff_role_invalid · 403 forbidden|cross_club · 409 principal_exists|role_exists ·
 * 500 generic.
 *
 * Sin CORS: la app nativa no es un navegador y no dispara preflight. El único
 * requisito de acceso es un bearer válido.
 */

import { NextResponse } from 'next/server';
import {
  assignStaffToTeam,
  TEAM_STAFF_ROLES,
  type AssignStaffError,
  type TeamStaffRole,
} from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mismo reparto de códigos que la web, traducido a HTTP. */
const STATUS: Record<AssignStaffError, number> = {
  team_invalid: 400,
  cross_club: 403,
  principal_exists: 409,
  role_exists: 409,
  forbidden: 403,
  generic: 500,
};

function esRolDeStaff(v: unknown): v is TeamStaffRole {
  return typeof v === 'string' && (TEAM_STAFF_ROLES as readonly string[]).includes(v);
}

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
    membershipId?: unknown;
    teamId?: unknown;
    staffRole?: unknown;
  };

  const membershipId = typeof b.membershipId === 'string' ? b.membershipId : '';
  if (!UUID_RE.test(membershipId)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  // `team_invalid` y no `invalid`: es el mismo código que devuelve el Zod de la web
  // para este campo, así que la app puede usar el MISMO texto para los dos caminos.
  const teamId = typeof b.teamId === 'string' ? b.teamId : '';
  if (!UUID_RE.test(teamId)) {
    return NextResponse.json({ error: 'team_invalid' }, { status: 400 });
  }
  if (!esRolDeStaff(b.staffRole)) {
    return NextResponse.json({ error: 'staff_role_invalid' }, { status: 400 });
  }

  const res = await assignStaffToTeam(auth.supabase, {
    membershipId,
    teamId,
    staffRole: b.staffRole,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: STATUS[res.error] });
  }

  return NextResponse.json({ status: 'ok' });
}
