/**
 * EL DRENADOR DE CADA MINUTO — solo para los avisos que CADUCAN.
 *
 * POR QUÉ EXISTE. El aviso de gol ya nace en la base (trigger `notify_goal`, mig
 * 20261126000000), así que un gol apuntado desde la app nativa crea su fila de push.
 * Pero crearla no es enviarla: el único drenador que había vive al final de
 * `/api/cron/reminders` y corre `0 8 * * *`. Un «GOL» a las ocho de la mañana
 * siguiente no es un aviso, y además `pushRowIsStale` lo descartaría — con razón.
 *
 * Y el envío inmediato de verdad (eager, desde un route handler que llame la app)
 * necesita publicar un build nuevo, que tarda días en pasar por las tiendas. Este cron
 * es lo que hace que el gol llegue a las familias HOY, con un minuto de retraso como
 * mucho, sin tocar la app.
 *
 * SOLO LO PERECEDERO (`onlyPerishable`): mira únicamente los tipos que tienen TTL
 * declarado en core (hoy el gol). Dos razones: es a lo único que le corre prisa, y así
 * una cola larga de recordatorios no le quita el sitio del `cap` a un gol.
 *
 * El resto de la cola sigue siendo del cron diario, que pasa sin filtro.
 *
 * Protección: `Authorization: Bearer ${CRON_SECRET}`, el mismo secreto de proyecto que
 * los demás crones. Sin secreto configurado responde 401 — falla CERRADO.
 */

import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@misterfc/core';
import { drainPushQueue } from '@/lib/drain-push-queue';

export const runtime = 'nodejs';

/**
 * Tope por pasada. Es alto a propósito para lo que mira: los goles de un sábado de
 * liga en todos los equipos de todos los clubes caben de sobra, y si un minuto se
 * queda corto el siguiente recoge el resto.
 */
const MAX_POR_PASADA = 200;

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const drain = await drainPushQueue(supabase, MAX_POR_PASADA, {
    onlyPerishable: true,
  });

  return NextResponse.json({ ok: true, push_drain: drain });
}
