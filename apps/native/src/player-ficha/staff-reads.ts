import {
  getPlayerNotesFromClient,
  readPlayerMedicalFromClient,
  type PlayerMedicalResult,
  type PlayerNotesResult,
} from '@misterfc/core';
import type { NativeDbClient } from '@/data/client-data';

/**
 * Las dos lecturas RESERVADAS de la ficha del cuerpo técnico —la médica y las
 * notas— con la regla que decide qué se queda guardado en el móvil.
 *
 * POR QUÉ ESTO NO ES UNA LÍNEA EN LA PANTALLA. `readThrough` (core, caché offline)
 * guarda en el almacén cifrado TODO lo que el lector DEVUELVE, y conserva lo que
 * ya había cuando el lector LANZA. Esos dos caminos son justo lo que hace falta
 * para separar dos «no» que no se parecen en nada:
 *
 *   · `forbidden` → se DEVUELVE. Es una respuesta del servidor: este lector ya no
 *     puede ver esto. Guardarla PISA la copia que hubiera en el teléfono, que es
 *     lo que promete la pantalla de consentimientos cuando un tutor lo retira:
 *     «la información de salud dejará de verse en la aplicación». Con la copia
 *     intacta, esa frase sería falsa en cuanto el móvil se quedara sin cobertura.
 *
 *   · `error` → se LANZA. Un fallo de red no dice nada sobre el permiso, y la
 *     ficha se abre en un campo de fútbol, que es donde peor va la cobertura. Si
 *     se devolviera, el entrenador perdería las alergias del crío que ya tenía
 *     descargadas justamente el día que no hay red. Lanzando, `readThrough`
 *     mantiene lo guardado y la pantalla saca su aviso de sin conexión.
 *
 * El mensaje del `throw` no se pinta en ningún sitio: lo único que importa es que
 * sea un camino de excepción. La pantalla no distingue este caso del resto de
 * fallos de red, y no tiene por qué.
 */

/**
 * El resultado de core SIN el estado transitorio: lo que queda es, justamente, lo
 * que tiene sentido guardar en el móvil. El tipo lo deja escrito, de modo que
 * devolver un `error` desde aquí no compila.
 */
type SinFalloTransitorio<R> = Extract<R, { ok: true }> | { ok: false; reason: 'forbidden' };

export type FichaMedical = SinFalloTransitorio<PlayerMedicalResult>;
export type FichaNotes = SinFalloTransitorio<PlayerNotesResult>;

export async function loadFichaMedical(
  sb: NativeDbClient,
  playerId: string | null,
): Promise<FichaMedical> {
  if (!playerId) return { ok: true, medical: null };
  const r = await readPlayerMedicalFromClient(sb, playerId);
  if (!r.ok) {
    if (r.reason === 'error') throw new Error('ficha_medical_unavailable');
    return { ok: false, reason: 'forbidden' };
  }
  return r;
}

export async function loadFichaNotes(
  sb: NativeDbClient,
  playerId: string | null,
): Promise<FichaNotes> {
  if (!playerId) return { ok: true, notes: [] };
  const r = await getPlayerNotesFromClient(sb, playerId);
  if (!r.ok) {
    if (r.reason === 'error') throw new Error('ficha_notes_unavailable');
    return { ok: false, reason: 'forbidden' };
  }
  return r;
}
