/**
 * Viaje 1 de 16 del botón de Calendario: qué equipos hay y el mapa de direcciones.
 *
 * Descarga el catálogo de campos (23 páginas) UNA vez y lo devuelve, para que los quince
 * viajes siguientes no lo descarguen cada uno. Ver `@/lib/ffcv-importar` para el porqué
 * de la forma entera.
 *
 * Respuestas: 200 {ok:true,...} · 401 · 403 · 409 no_active_season · 502 ffcv.
 */

import { NextResponse } from 'next/server';
import { prepararFfcv } from '@/lib/ffcv-importar';

export const runtime = 'nodejs';
/** 23 páginas del catálogo a 60 peticiones/min: holgado, pero el techo por defecto no basta. */
export const maxDuration = 300;

export async function POST(req: Request) {
  const r = await prepararFfcv(req);
  if (!r.ok) {
    const status =
      r.error === 'unauthorized'
        ? 401
        : r.error === 'forbidden'
          ? 403
          : r.error === 'no_active_season'
            ? 409
            : 502;
    return NextResponse.json({ error: r.error, detalle: r.detalle ?? null }, { status });
  }
  return NextResponse.json({
    ok: true,
    equipos: r.datos.importables.map((e) => ({ teamId: e.teamId, nombre: e.nombre })),
    sinUbicacion: r.datos.sinUbicacion.map((e) => ({ teamId: e.teamId, nombre: e.nombre })),
    sinVincular: r.datos.sinVincular.map((e) => ({ teamId: e.teamId, nombre: e.nombre })),
    direcciones: r.datos.direcciones,
  });
}
