/**
 * O2-7b-2 — Endpoint "publicar / republicar convocatoria" para la app nativa (cierra
 * O2-7). Una sola ruta con discriminador `mode` ('publish' | 'republish'): comparten
 * auth (bearer/cookie), y solo cambia el orquestador de core invocado.
 *
 * Orden de seguridad (invariante, patrón F1/F3):
 *   1. `resolveUserFromRequest` valida el bearer/cookie (getUser) → 401 si inválido.
 *      Cliente RLS-scoped al usuario, nunca admin.
 *   2. El cambio de estado (match_callup_meta.published_at) se hace con ese cliente:
 *      la RLS (`user_can_manage_callup`) exige ser staff de gestión del equipo. Un no
 *      autorizado → 42501 → 403 y NO se dispara el fan-out.
 *   3. El fan-out (service-role: destinatarios + campana + push blindado) va DESPUÉS
 *      del cambio de estado, dentro del wrapper `publish-callup` (core + inyección).
 *
 * Respuestas: 200 {ok:true, published?} · 401 · 400 invalid · 403 forbidden ·
 * 404 not_found · 409 conflict (not_published/event_started/too_many_called_up) · 500.
 */

import { NextResponse } from 'next/server';
import type {
  PublishCallupError,
  RepublishCallupError,
} from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';
import { publishCallupWeb, republishCallupWeb } from '@/lib/publish-callup';

export const runtime = 'nodejs';

function statusForPublish(error: PublishCallupError): number {
  switch (error) {
    case 'forbidden':
      return 403;
    case 'too_many_called_up':
      return 409;
    case 'generic':
      return 500;
    // event_invalid / meeting_* / transport_* / notes_* / event_not_match /
    // event_without_team / cannot_unpublish → payload/estado inválido.
    default:
      return 400;
  }
}

function statusForRepublish(error: RepublishCallupError): number {
  switch (error) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'not_published':
    case 'event_started':
    case 'too_many_called_up':
      return 409;
    default:
      return 500;
  }
}

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
  const b = (raw ?? {}) as { mode?: unknown; eventId?: unknown };

  if (b.mode === 'republish') {
    const eventId = typeof b.eventId === 'string' ? b.eventId : '';
    if (!eventId) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 });
    }
    const res = await republishCallupWeb(auth.supabase, eventId);
    if (!res.ok) {
      return NextResponse.json(
        {
          error: res.error,
          ...(res.overflow != null ? { overflow: res.overflow } : {}),
          ...(res.maxCalledUp != null ? { maxCalledUp: res.maxCalledUp } : {}),
        },
        { status: statusForRepublish(res.error) },
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Por defecto 'publish': el cuerpo es el payload de publishCallupSchema
  // (event_id + datos de citación + publish). Core valida y publica como el usuario.
  const res = await publishCallupWeb(auth.supabase, raw);
  if (!res.ok) {
    return NextResponse.json(
      {
        error: res.error,
        ...(res.overflow != null ? { overflow: res.overflow } : {}),
        ...(res.maxCalledUp != null ? { maxCalledUp: res.maxCalledUp } : {}),
      },
      { status: statusForPublish(res.error) },
    );
  }
  return NextResponse.json({ ok: true, published: res.published });
}
