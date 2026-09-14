/**
 * R-2 — purga del registro de intentos del endpoint público de aceptación.
 *
 * Frecuencia: CADA HORA (`0 * * * *`), y no diaria como los otros tres crons. El motivo
 * es el registro de tratamiento, no la técnica:
 *
 *   El dato no muere cuando vence la retención, sino cuando pasa el cron y lo borra. La
 *   función borra a las 25 h, así que la vida máxima real es 25 h MÁS lo que tarde en
 *   pasar el cron. Con cadencia diaria eso son hasta 49 horas —casi dos días—, y sería
 *   lo que habría que declarar. Con cadencia horaria son 26, que es un número que se
 *   parece a lo acordado y que se puede sostener por escrito.
 *
 * Y las 25 h de la función tampoco son redondeo: el contador mira una ventana de 24 h
 * para la regla de 60/24h. Purgar justo a 24 le recortaría la cola por detrás y ese
 * límite quedaría más flojo de lo que dice, en silencio.
 *
 * DATO DECLARADO: IP del cliente, vida máxima 26 h.
 *
 * Protección: `Authorization: Bearer ${CRON_SECRET}`, el mismo secreto de proyecto que
 * usan los otros crons. Sin secreto configurado responde 401 — falla CERRADO.
 */

import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@misterfc/core';

export const runtime = 'nodejs';

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('purge_invite_accept_attempts');

  if (error) {
    return NextResponse.json({ error: 'purge_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: (data as number | null) ?? 0 });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron envía GET por defecto; se aceptan los dos, como en los otros crons.
  return handle(req);
}
