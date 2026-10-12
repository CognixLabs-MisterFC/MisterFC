/**
 * F-4 · El título del evento.
 *
 * ── LA REGLA, decidida por Jose el 2026-10-12 ───────────────────────────────────────
 * El título lleva el ORDEN DE LA FFCV: primero el local. Así el orden ya dice dónde se
 * juega y no hace falta una columna de casa/fuera:
 *
 *   «Infantil B - Nazaret C»   → se juega en casa
 *   «Nazaret C - Infantil B»   → se juega en campo del rival
 *
 * Nuestro lado va con su nombre de MisterFC («Infantil B»), no con el de la federación
 * («U.D. Fonteta 'B'»), porque es el que la familia reconoce. El del rival va VERBATIM
 * de la FFCV, sin las comillas, y sin alias: una lista de alias por rival se rompe cada
 * temporada, y el nombre completo cabe de sobra —el título más largo de la temporada
 * medida son 47 caracteres y la columna admite 200.
 *
 * Y por eso poner solo «Fonteta» no servía: los quince equipos del club darían el mismo
 * título y nadie distinguiría el partido del Alevín B del del Juvenil A.
 */

import type { PartidoFfcv } from './types';

/** El CHECK de la columna: `char_length(title) between 1 and 200`. */
export const TITULO_MAX = 200;
/** El CHECK de `opponent_name`: entre 1 y 120. */
export const RIVAL_MAX = 120;
/** El CHECK de `location_name`: entre 1 y 160. */
export const CAMPO_MAX = 160;

/** «Local - Visitante», con nuestro equipo nombrado como en MisterFC. */
export function tituloDePartido(nombreEquipo: string, partido: PartidoFfcv): string {
  const nuestro = nombreEquipo.trim();
  const suyo = partido.rival.trim();
  return partido.enCasa ? `${nuestro} - ${suyo}` : `${suyo} - ${nuestro}`;
}
