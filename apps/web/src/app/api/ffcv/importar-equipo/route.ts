/**
 * Viajes 2 a 16 del botón de Calendario: los partidos de UN equipo.
 *
 * Un viaje por equipo porque los quince no caben en una invocación: ~29 llamadas a la
 * FFCV por equipo y la FFCV corta a 60 por minuto (#769). Aislado a propósito: que un
 * equipo falle no impide importar los otros catorce (decisión 2 de Jose).
 *
 * SOLO CREA. Un partido que ya existe no se toca, así que repetir el viaje es seguro: es
 * lo que hace que cerrar la pestaña a mitad no deje nada a medias.
 *
 * Respuestas: 200 {ok:true,resumen} · 400 invalid · 401 · 403 · 404 · 409 · 502.
 */

import { NextResponse } from 'next/server';
import { importarEquipoFfcv } from '@/lib/ffcv-importar';

export const runtime = 'nodejs';
/**
 * 29 llamadas marcando el paso a 60/min son ~35 s, y el techo por defecto son 15 s: sin
 * esto la importación muere a mitad del primer equipo. 300 s es el máximo del plan Pro y
 * deja sitio para una ventana de 503 del origen.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const cuerpo = (raw ?? {}) as { teamId?: unknown; direcciones?: unknown };

  const r = await importarEquipoFfcv(req, {
    teamId: cuerpo.teamId,
    direcciones: cuerpo.direcciones ?? {},
  });
  if (!r.ok) {
    const status =
      r.error === 'unauthorized'
        ? 401
        : r.error === 'forbidden'
          ? 403
          : r.error === 'not_found'
            ? 404
            : r.error === 'invalid'
              ? 400
              : r.error === 'no_active_season'
                ? 409
                : 502;
    return NextResponse.json({ error: r.error, detalle: r.detalle ?? null }, { status });
  }
  return NextResponse.json({ ok: true, resumen: r.resumen });
}
