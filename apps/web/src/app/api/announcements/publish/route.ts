/**
 * O2-10b-1b — Endpoint "publicar anuncio" para la app nativa (staff). Es el trozo con
 * SERVICE-ROLE de la comunicación del cuerpo técnico.
 *
 * Orden de seguridad (invariante, patrón F1/F3/7b-2):
 *   1. `resolveUserFromRequest` valida el bearer/cookie (getUser) → 401 si inválido.
 *      Cliente RLS-scoped al usuario, nunca admin.
 *   2. El club se deriva del equipo LEYENDO con ese cliente (RLS): si el usuario no ve
 *      el equipo → 403 (no puede publicarle). El INSERT en `announcements` se hace con
 *      ese cliente: la RLS `announcements_insert_managers` exige rol de gestión o
 *      `can_message_families`. Un no autorizado → 42501 → 403 y NO se dispara el fan-out.
 *   3. El fan-out (service-role: familias del equipo, campana + push blindado O2-4) va
 *      DESPUÉS del insert, dentro del wrapper `publish-announcement` (core + inyección).
 *
 * Respuestas: 200 {ok:true, announcementId} · 401 · 400 invalid · 403 forbidden · 500.
 */

import { NextResponse } from 'next/server';
import { announcementInputSchema } from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { publishAnnouncementWeb } from '@/lib/publish-announcement';

export const runtime = 'nodejs';

const LOCALE_RE = /^[a-z]{2}$/;

export async function POST(req: Request) {
  const auth = await resolveUserFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const b = (raw ?? {}) as {
    teamId?: unknown;
    title?: unknown;
    body?: unknown;
    pinned?: unknown;
    expiresAt?: unknown;
    locale?: unknown;
  };

  // Valida el contenido con el MISMO schema que la Server Action web.
  const parsed = announcementInputSchema.safeParse({
    team_id: typeof b.teamId === 'string' ? b.teamId : '',
    title: b.title,
    body: b.body,
    pinned: b.pinned,
    expires_at: b.expiresAt ?? null,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const locale =
    typeof b.locale === 'string' && LOCALE_RE.test(b.locale) ? b.locale : 'es';

  // Deriva el club del equipo con el cliente del usuario (RLS). Si no lo ve → 403:
  // no puede publicarle. Evita depender de un "club activo" por cookie (bearer no lo
  // tiene). El club_id resultante alimenta el INSERT (que la RLS vuelve a gatear).
  const { data: teamRow } = await auth.supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('id', parsed.data.team_id)
    .maybeSingle();
  const clubId = (teamRow?.categories as unknown as { club_id: string } | null)?.club_id;
  if (!teamRow || !clubId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const res = await publishAnnouncementWeb(auth.supabase, {
    clubId,
    authorProfileId: auth.user.id,
    teamId: parsed.data.team_id,
    title: parsed.data.title,
    body: parsed.data.body,
    pinned: parsed.data.pinned,
    expiresAt: parsed.data.expires_at,
    locale,
  });

  if ('error' in res) {
    const status =
      res.error === 'forbidden' || res.error === 'team_not_in_club' ? 403 : 500;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ ok: true, announcementId: res.ok.announcementId });
}
