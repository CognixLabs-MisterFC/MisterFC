/**
 * F-3 · La fecha y la hora de la FFCV → un instante UTC.
 *
 * La FFCV da la fecha y la hora en LOCAL de Madrid y por separado: `fecha` con barras
 * (`18/10/2026`) en los partidos y con guiones (`18-10-2026`) en las jornadas, y `hora`
 * como `HH:MM`. `events.starts_at` es `timestamptz`, así que hay que resolver el huso.
 *
 * ── POR QUÉ ESTO NO ES UNA RESTA DE HORAS ───────────────────────────────────────────
 * El calendario de una liga va de octubre a mayo y CRUZA EL CAMBIO DE HORA DOS VECES.
 * En el del Infantil B medido el 2026-10-12: la jornada 2 es el 24-10-2026, el día ANTES
 * del cambio de octubre, y de la jornada 18 en adelante ya rige el de marzo de 2027. Un
 * desplazamiento fijo de +01:00 o +02:00 movería media temporada una hora, y el síntoma
 * sería una familia llegando tarde a un partido, no un error en un log.
 *
 * No se inventa nada: `fromZonedFields` (packages/core/src/events/tz.ts) ya existe y está
 * escrita exactamente para preservar la hora local a través del DST —la usa el generador
 * de recurrencias—. Aquí solo se parsea y se delega.
 */

import { fromZonedFields } from '../events/tz';
import { TIMEZONE_OLA1 } from '../events/types';

/** `18/10/2026` o `18-10-2026` → sus tres números, o null si no tiene esa forma. */
export function partirFecha(fecha: string): { dia: number; mes: number; anio: number } | null {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(fecha.trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return { dia, mes, anio };
}

/** `16:00` → sus dos números, o null. Acepta `9:00` por si acaso. */
export function partirHora(hora: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/**
 * Fecha + hora de la FFCV → instante UTC en ISO.
 *
 * Devuelve null si alguna de las dos no tiene la forma esperada; el llamante decide, y
 * en F-4 eso significa dejar el partido fuera en vez de inventarse una hora.
 */
export function aIsoUtc(fecha: string, hora: string, zona: string = TIMEZONE_OLA1): string | null {
  const f = partirFecha(fecha);
  const h = partirHora(hora);
  if (!f || !h) return null;
  // `fromZonedFields` toma el mes 0-based, como JS Date.
  const d = fromZonedFields(f.anio, f.mes - 1, f.dia, h.h, h.m, zona);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  return d.toISOString();
}
